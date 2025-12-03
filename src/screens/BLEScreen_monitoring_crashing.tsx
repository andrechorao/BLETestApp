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
import {
  BleManager,
  Device,
  State as BleState,
  Characteristic,
  Subscription,
} from "react-native-ble-plx";
import { Buffer } from "buffer";

const DEVICE_NAME = "FluxmonEtiquetav2";

const SERVICE_UUID = "6E400000-B5A3-F393-E0A9-E50E24DCCA9E";
const LOTE_CHAR_UUID = "6E400001-B5A3-F393-E0A9-E50E24DCCA9E";
// #define VAL_CHAR_UUID "6E400002-B5A3-F393-E0A9-E50E24DCCA9E" // concatenated with lote
const SERIAL_NUM_CHAR_UUID = "6E400010-B5A3-F393-E0A9-E50E24DCCA9E";

const SERVICE2_UUID = "6E400012-B5A3-F393-E0A9-E50E24DCCA9E";
const LITERS_CHAR_UUID = "6E400013-B5A3-F393-E0A9-E50E24DCCA9E";
const FLOW_CHAR_UUID = "6E400014-B5A3-F393-E0A9-E50E24DCCA9E";
const LITERS2_CHAR_UUID = "6E400015-B5A3-F393-E0A9-E50E24DCCA9E";
const FLOW2_CHAR_UUID = "6E400016-B5A3-F393-E0A9-E50E24DCCA9E";
const VCC_CHAR_UUID = "6E400017-B5A3-F393-E0A9-E50E24DCCA9E";

#define RESET_LITERS_CHAR_UUID "6E400018-B5A3-F393-E0A9-E50E24DCCA9E"
#define RESET_LITERS2_CHAR_UUID "6E400019-B5A3-F393-E0A9-E50E24DCCA9E"


export default function BLEScreen2() {
  const ble = useRef(new BleManager()).current;
  const mounted = useRef(true);
  const connected = useRef<Device | null>(null);

  const disconnectSub = useRef<Subscription | null>(null);

  const litersSub = useRef<Subscription | null>(null);
  const flowSub = useRef<Subscription | null>(null);
  const vccSub = useRef<Subscription | null>(null);

  const [log, setLog] = useState("Idle");
  const [isConnected, setIsConnected] = useState(false);

  // static info
  const [serialNum, setSerialNum] = useState("-");
  const [lote, setLote] = useState("-");
  const [validade, setValidade] = useState("-");

  // live info
  const [liters, setLiters] = useState("-");
  const [flow, setFlow] = useState("-");
  const [vcc, setVcc] = useState("-");

  const safeLog = (s: string) => {
    if (mounted.current) setLog(s);
  };

  const clearLiveSubs = () => {
    try {
      litersSub.current?.remove();
    } catch {}
    try {
      flowSub.current?.remove();
    } catch {}
    try {
      vccSub.current?.remove();
    } catch {}

    litersSub.current = null;
    flowSub.current = null;
    vccSub.current = null;
  };

  const clearDisconnectSub = () => {
    try {
      disconnectSub.current?.remove();
    } catch {}
    disconnectSub.current = null;
  };

  useEffect(() => {
    return () => {
      mounted.current = false;

      try {
        ble.stopDeviceScan();
      } catch {}

      clearLiveSubs();
      clearDisconnectSub();

      (async () => {
        try {
          await connected.current?.cancelConnection();
        } catch {}
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
    if (state !== BleState.PoweredOn) {
      for (let i = 0; i < 8 && state !== BleState.PoweredOn; i++) {
        await new Promise((r) => setTimeout(r, 500));
        state = await ble.state();
      }
    }
    if (state !== BleState.PoweredOn) {
      throw new Error(`Bluetooth is ${state}, turn it on.`);
    }
  }

  const startScan = async () => {
    try {
      await ensurePermsAndState();
      safeLog("Scanning…");

      ble.startDeviceScan(null, { allowDuplicates: false }, (error, device) => {
        if (!mounted.current) return;

        if (error) {
          safeLog(`Scan error: ${error.message}`);
          try {
            ble.stopDeviceScan();
          } catch {}
          return;
        }

        if (device?.name === DEVICE_NAME) {
          try {
            ble.stopDeviceScan();
          } catch {}
          safeLog(`Found ${DEVICE_NAME}, connecting…`);
          connectTo(device);
        }
      });

      // stop after 10s
      setTimeout(() => {
        try {
          ble.stopDeviceScan();
        } catch {}
      }, 10000);
    } catch (e: any) {
      Alert.alert("BLE error", e?.message ?? String(e));
    }
  };

  const connectTo = async (device: Device) => {
    try {
      // clean previous stuff if any
      clearLiveSubs();
      clearDisconnectSub();

      const d = await ble.connectToDevice(device.id, { autoConnect: false });
      connected.current = d;
      if (mounted.current) setIsConnected(true);

      safeLog("Connected, discovering services…");
      await d.discoverAllServicesAndCharacteristics();
      await new Promise((r) => setTimeout(r, 150)); // let GATT settle

      // watch disconnect (single subscription, stored in ref)
      disconnectSub.current = ble.onDeviceDisconnected(d.id, () => {
        // this may fire when you power off the Arduino
        clearLiveSubs();
        connected.current = null;

        if (mounted.current) {
          safeLog("Device disconnected");
          setIsConnected(false);
        }
      });

      // --- READ STATIC VALUES ---
      await readStaticValues(d);

      // --- SUBSCRIBE TO LIVE FLOATS ---
      subscribeLive(d);

      safeLog("Listening for live updates…");
    } catch (e: any) {
      safeLog(`Connect error: ${e?.message ?? e}`);
      if (mounted.current) {
        setIsConnected(false);
      }
      connected.current = null;
      clearLiveSubs();
      clearDisconnectSub();
    }
  };

  const readStaticValues = async (device: Device) => {
    try {
      // SERIAL NUMBER
      const serialChar = await device.readCharacteristicForService(
        SERVICE_UUID,
        SERIAL_NUM_CHAR_UUID
      );
      const serialVal = Buffer.from(serialChar.value ?? "", "base64").toString("utf8");
      if (mounted.current) setSerialNum(serialVal);

      // LOTE_VAL
      const loteChar = await device.readCharacteristicForService(
        SERVICE_UUID,
        LOTE_CHAR_UUID
      );
      const loteValRaw = Buffer.from(loteChar.value ?? "", "base64").toString("utf8");
      const [loteStr, valStr] = loteValRaw.split("_");

      if (mounted.current) {
        setLote(loteStr ?? "-");
        setValidade(valStr ?? "-");
      }
    } catch (err: any) {
      safeLog("Error reading static data: " + err.message);
    }
  };

  const subscribeLive = (device: Device) => {
    // LITERS
    litersSub.current = device.monitorCharacteristicForService(
      SERVICE2_UUID,
      LITERS_CHAR_UUID,
      (error, char) => {
        if (error) {
          safeLog("Liters notify error: " + error.message);
          return;
        }
        const v = decodeFloat(char);
        if (v !== null && mounted.current) {
          setLiters(v.toFixed(3));
        }
      }
    );

    // FLOW
    flowSub.current = device.monitorCharacteristicForService(
      SERVICE2_UUID,
      FLOW_CHAR_UUID,
      (error, char) => {
        if (error) {
          safeLog("Flow notify error: " + error.message);
          return;
        }
        const v = decodeFloat(char);
        if (v !== null && mounted.current) {
          setFlow(v.toFixed(3));
        }
      }
    );

    // VCC
    vccSub.current = device.monitorCharacteristicForService(
      SERVICE2_UUID,
      VCC_CHAR_UUID,
      (error, char) => {
        if (error) {
          safeLog("Vcc notify error: " + error.message);
          return;
        }
        const v = decodeFloat(char);
        if (v !== null && mounted.current) {
          setVcc(v.toFixed(3));
        }
      }
    );
  };

  const decodeInt = (char: Characteristic | null): number | null => {
    try {
      const b = Buffer.from(char?.value ?? "", "base64");
      if (b.length >= 4) {
        return b[0] | (b[1] << 8) | (b[2] << 16) | (b[3] << 24);
      }
      return null;
    } catch {
      return null;
    }
  };

  const decodeFloat = (char: Characteristic | null): number | null => {
    try {
      const b = Buffer.from(char?.value ?? "", "base64");
      if (b.length < 4) return null;

      const buf = new ArrayBuffer(4);
      const view = new DataView(buf);
      b.forEach((v, i) => view.setUint8(i, v));

      return view.getFloat32(0, true); // little-endian
    } catch {
      return null;
    }
  };

  return (
    <SafeAreaView
      style={{
        flex: 1,
        backgroundColor: "#000",
        alignItems: "center",
        paddingTop: 50,
      }}
    >
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

      {/* STATIC INFO */}
      <Text style={{ color: "#ffe066", marginTop: 30, fontSize: 22 }}>
        Serial: {serialNum}
      </Text>
      <Text style={{ color: "#ffe066", marginTop: 10, fontSize: 22 }}>
        Lote: {lote}
      </Text>
      <Text style={{ color: "#ffe066", marginTop: 10, fontSize: 22 }}>
        Validade: {validade}
      </Text>

      {/* LIVE FLOATS */}
      <Text
        style={{
          color: isConnected ? "#f55" : "#888",
          marginTop: 30,
          fontSize: 28,
        }}
      >
        Vcc: {vcc} V
      </Text>
      <Text
        style={{
          color: isConnected ? "#0f0" : "#888",
          marginTop: 30,
          fontSize: 28,
        }}
      >
        Flow: {flow} L/min
      </Text>
      <Text
        style={{
          color: isConnected ? "#0f0" : "#888",
          marginTop: 20,
          fontSize: 28,
        }}
      >
        Liters: {liters} L
      </Text>

      <Text style={{ color: "#777", marginTop: 40 }}>{log}</Text>
    </SafeAreaView>
  );
}
