// src/screens/BLEScreen.tsx
import React, { useRef, useState, useEffect } from "react";
import {
  SafeAreaView,
  Text,
  TouchableOpacity,
  Alert,
  PermissionsAndroid,
  Platform,
} from "react-native";

import { BleManager, Device, State as BleState, Characteristic, Subscription } from "react-native-ble-plx";
import { Buffer } from "buffer";

const DEVICE_NAME = "FluxmonEtiquetav2";

const SERVICE_UUID = "6E400000-B5A3-F393-E0A9-E50E24DCCA9E";
const LOTE_CHAR_UUID = "6E400001-B5A3-F393-E0A9-E50E24DCCA9E";
const SERIAL_NUM_CHAR_UUID = "6E400010-B5A3-F393-E0A9-E50E24DCCA9E";

const SERVICE2_UUID = "6E400012-B5A3-F393-E0A9-E50E24DCCA9E";
const LITERS_CHAR_UUID = "6E400013-B5A3-F393-E0A9-E50E24DCCA9E";
const FLOW_CHAR_UUID = "6E400014-B5A3-F393-E0A9-E50E24DCCA9E";
const VCC_CHAR_UUID = "6E400015-B5A3-F393-E0A9-E50E24DCCA9E";

export default function BLEScreen2() {
  const ble = useRef(new BleManager()).current;
  const mounted = useRef(true);

  const connected = useRef<Device | null>(null);
  const disconnectSub = useRef<Subscription | null>(null);
  const pollTimer = useRef<NodeJS.Timer | null>(null);

  const [log, setLog] = useState("Idle");
  const [isConnected, setIsConnected] = useState(false);

  const [serialNum, setSerialNum] = useState("-");
  const [lote, setLote] = useState("-");
  const [validade, setValidade] = useState("-");

  const [liters, setLiters] = useState("-");
  const [flow, setFlow] = useState("-");
  const [vcc, setVcc] = useState("-");

  const safeLog = (txt: string) => mounted.current && setLog(txt);

  const stopPolling = () => {
    if (pollTimer.current) {
      clearInterval(pollTimer.current);
      pollTimer.current = null;
    }
  };

  const clearDisconnectSub = () => {
    try { disconnectSub.current?.remove(); } catch {}
    disconnectSub.current = null;
  };

  useEffect(() => {
    return () => {
      mounted.current = false;
      try { ble.stopDeviceScan(); } catch {}
      stopPolling();
      clearDisconnectSub();
      (async () => {
        try { await connected.current?.cancelConnection(); } catch {}
        ble.destroy();
      })();
    };
  }, []);

  async function ensurePermsAndState() {
    if (Platform.OS === "android") {
      await PermissionsAndroid.requestMultiple([
        PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
        PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
        PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
      ]);
    }

    let state = await ble.state();
    for (let i = 0; i < 8 && state !== BleState.PoweredOn; i++) {
      await new Promise((r) => setTimeout(r, 500));
      state = await ble.state();
    }
    if (state !== BleState.PoweredOn)
      throw new Error(`Bluetooth is ${state}`);
  }

  const startScan = async () => {
    try {
      await ensurePermsAndState();
      safeLog("Scanning…");

      ble.startDeviceScan(null, { allowDuplicates: false }, (error, device) => {
        if (!mounted.current) return;

        if (error) {
          safeLog("Scan error: " + error.message);
          try { ble.stopDeviceScan(); } catch {}
          return;
        }

        if (device?.name === DEVICE_NAME) {
          try { ble.stopDeviceScan(); } catch {}
          safeLog("Found, connecting…");
          connectTo(device);
        }
      });

      setTimeout(() => {
        try { ble.stopDeviceScan(); } catch {}
      }, 10000);
    } catch (e: any) {
      Alert.alert("BLE error", e.message ?? String(e));
    }
  };

  // Quando vai conectar a um device
  const connectTo = async (device: Device) => {
    try {
      stopPolling();
      clearDisconnectSub();

      const d = await ble.connectToDevice(device.id, { autoConnect: false });
      connected.current = d;
      setIsConnected(true);
      safeLog("Connected, discovering…");

      await d.discoverAllServicesAndCharacteristics();
      await new Promise((r) => setTimeout(r, 150));
      disconnectSub.current = ble.onDeviceDisconnected(d.id, async () => {
        // 🛑 STOP POLLING FIRST
        stopPolling();
      
        // 2. 🚨 CRITICAL: Explicitly cancel the connection.
        // This stops any pending or future native operations on this device.
        try {
           //await connected.current?.cancelConnection();
           await d.cancelConnection(); // Use 'd', the local variable for the connected device
        } catch (e) {
           // Ignore cancel errors; the device is already gone.
        }

        connected.current = null;
        setIsConnected(false);
        safeLog("Device disconnected");
      });

      await readStaticValues(d);

      startLivePolling(d);
      safeLog("Polling…");

    } catch (err: any) {
      safeLog("Connect error: " + err.message);
      connected.current = null;
      stopPolling();
      clearDisconnectSub();
      setIsConnected(false);
    }
  };

  const readStaticValues = async (device: Device) => {
    try {
      if (!connected.current) return; // <-- PREVENT CRASH

      const serialChar = await device.readCharacteristicForService(SERVICE_UUID, SERIAL_NUM_CHAR_UUID);
      const serial = Buffer.from(serialChar.value ?? "", "base64").toString("utf8");
      setSerialNum(serial);

      if (!connected.current) return; // <-- PREVENT CRASH

      const loteChar = await device.readCharacteristicForService(SERVICE_UUID, LOTE_CHAR_UUID);
      const text = Buffer.from(loteChar.value ?? "", "base64").toString("utf8");
      const [l, v] = text.split("_");

      setLote(l ?? "-");
      setValidade(v ?? "-");

    } catch (err: any) {
      safeLog("Static read error: " + err.message);
    }
  };

  // Monitor de variaveis
  const startLivePolling = (device: Device) => {
    stopPolling();

    pollTimer.current = setInterval(async () => {
      if (!connected.current || !mounted.current) {
        // This check catches if the timer fires after a manual disconnect
        stopPolling();
        return;
      }

      try {
        // 🛑 Check 1
        if (!connected.current) return;

        // 🛑 CRITICAL CHECK 2: Before the first async operation!
        // This 'device' object might be internally invalid after disconnect.
        if (connected.current.id !== device.id) {
             // This is a defensive check, ensuring the device object
             // we are using for reads is the one we think we're connected to.
             // If connected.current is null, the check above catches it.
             return;
        }
        
        const litersChar = await device.readCharacteristicForService(SERVICE2_UUID, LITERS_CHAR_UUID);
        setLiters(decodeFloat(litersChar)?.toFixed(3) ?? "-");

        if (!connected.current) return;

        const flowChar = await device.readCharacteristicForService(SERVICE2_UUID, FLOW_CHAR_UUID);
        setFlow(decodeFloat(flowChar)?.toFixed(3) ?? "-");

        if (!connected.current) return;

        const vccChar = await device.readCharacteristicForService(SERVICE2_UUID, VCC_CHAR_UUID);
        setVcc(decodeFloat(vccChar)?.toFixed(3) ?? "-");

      } catch (err: any) {
        safeLog("Poll error: " + err.message);
        
        // This aggressively handles a *failed* read by stopping the timer,
        // which helps if the connection drop didn't perfectly trigger the onDeviceDisconnected handler first.
       // if (String(err.message).includes("disconnected")) {
             connected.current = null;
             stopPolling();
             clearDisconnectSub();
             setIsConnected(false);
       // }

      }
    }, 500);
  };

  const decodeFloat = (char: Characteristic): number | null => {
    try {
      const b = Buffer.from(char?.value ?? "", "base64");
      if (b.length < 4) return null;

      const buf = new ArrayBuffer(4);
      const v = new DataView(buf);
      b.forEach((x, i) => v.setUint8(i, x));

      return v.getFloat32(0, true);
    } catch {
      return null;
    }
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: "#000", alignItems: "center", paddingTop: 50 }}>
      <TouchableOpacity
        onPress={startScan}
        style={{
          backgroundColor: isConnected ? "#00cc66" : "#4c8bf5",
          padding: 16,
          borderRadius: 10,
        }}
      >
        <Text style={{ color: "#fff", fontWeight: "bold" }}>
          {isConnected ? "Connected" : "Connect & Monitor"}
        </Text>
      </TouchableOpacity>

      <Text style={{ color: "#ffe066", marginTop: 30, fontSize: 22 }}>Serial: {serialNum}</Text>
      <Text style={{ color: "#ffe066", marginTop: 10, fontSize: 22 }}>Lote: {lote}</Text>
      <Text style={{ color: "#ffe066", marginTop: 10, fontSize: 22 }}>Validade: {validade}</Text>

       <Text style={{ color: "#f55", marginTop: 30, fontSize: 28 }}>Vcc: {vcc} V</Text>
      <Text style={{ color: "#0f0", marginTop: 30, fontSize: 28 }}>Flow: {flow}</Text>
      <Text style={{ color: "#0f0", marginTop: 20, fontSize: 28 }}>Liters: {liters}</Text>

      <Text style={{ color: "#777", marginTop: 40 }}>{log}</Text>
    </SafeAreaView>
  );
}