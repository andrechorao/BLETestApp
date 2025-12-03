// src/screens/BLEScreen.tsx
import React, { useRef, useState, useEffect } from "react";
import {
  SafeAreaView,
  Text,
  TouchableOpacity,
  Alert,
  PermissionsAndroid,
  Platform,
  FlatList,
  View,
  NativeEventEmitter,
  NativeModules,
} from "react-native";

import BleManager from "react-native-ble-manager";
import { Buffer } from "buffer";

const BleManagerModule = NativeModules.BleManager;
const bleEmitter = new NativeEventEmitter(BleManagerModule);

// Simple type for devices in the list
type Peripheral = {
  id: string;
  name?: string;
};

////////////////////////////////////////////////////////////
const DEVICE_NAME = "FluxmonEtiquetav2";

// SERVICE / CHARACTERISTICS
const SERVICE_UUID = "6E400000-B5A3-F393-E0A9-E50E24DCCA9E";
const LOTE_CHAR_UUID = "6E400001-B5A3-F393-E0A9-E50E24DCCA9E";
const SERIAL_NUM_CHAR_UUID = "6E400002-B5A3-F393-E0A9-E50E24DCCA9E";

const SERVICE2_UUID = "6E400010-B5A3-F393-E0A9-E50E24DCCA9E";
const LITERS_CHAR_UUID = "6E400011-B5A3-F393-E0A9-E50E24DCCA9E";
const FLOW_CHAR_UUID = "6E400012-B5A3-F393-E0A9-E50E24DCCA9E";
const VCC_CHAR_UUID = "6E400013-B5A3-F393-E0A9-E50E24DCCA9E";

const SERVICE3_UUID = "6E400020-B5A3-F393-E0A9-E50E24DCCA9E";
const LITERS2_CHAR_UUID = "6E400021-B5A3-F393-E0A9-E50E24DCCA9E";
const FLOW2_CHAR_UUID = "6E400022-B5A3-F393-E0A9-E50E24DCCA9E";

const SERVICE4_UUID = "6E400030-B5A3-F393-E0A9-E50E24DCCA9E";
const RESET_LITERS_CHAR_UUID = "6E400031-B5A3-F393-E0A9-E50E24DCCA9E";
const RESET_LITERS2_CHAR_UUID = "6E400032-B5A3-F393-E0A9-E50E24DCCA9E";

//////////////////////////////////////////////////////////////
export default function BLEScreen2() {
  const mounted = useRef(true);
  const pollTimer = useRef<NodeJS.Timer | null>(null);

  // keep the connected peripheral id in a ref (for timers) + state (for UI)
  const connectedIdRef = useRef<string | null>(null);

  const [connectedId, setConnectedId] = useState<string | null>(null);
  const [log, setLog] = useState("Idle");
  const [isConnected, setIsConnected] = useState(false);
  const [isScanning, setIsScanning] = useState(false);

  // list of found devices (only FluxmonEtiquetav2)
  const [devices, setDevices] = useState<Peripheral[]>([]);

  // static info
  const [serialNum, setSerialNum] = useState("-");
  const [lote, setLote] = useState("-");
  const [validade, setValidade] = useState("-");

  // live info
  const [liters, setLiters] = useState("-");
  const [flow, setFlow] = useState("-");
  const [liters2, setLiters2] = useState("-");
  const [flow2, setFlow2] = useState("-");
  const [vcc, setVcc] = useState("-");

  const safeLog = (s: string) => {
    if (mounted.current) setLog(s);
  };

  const stopPolling = () => {
    if (pollTimer.current) {
      clearInterval(pollTimer.current);
      pollTimer.current = null;
    }
  };

  const stopScan = () => {
    try {
      BleManager.stopScan();
    } catch { }
    if (mounted.current) setIsScanning(false);
  };

  // -------------------------------------------------------
  // INIT + EVENT LISTENERS
  // -------------------------------------------------------
  useEffect(() => {
    mounted.current = true;

    // init BLE
    BleManager.start({ showAlert: false }).catch(() => { });

    // when we discover peripherals
    const subDiscover = bleEmitter.addListener(
      "BleManagerDiscoverPeripheral",
      (peripheral: any) => {
        if (!mounted.current) return;
        if (!peripheral?.name) return;
        if (peripheral.name !== DEVICE_NAME) return;

        setDevices((prev) => {
          if (prev.find((d) => d.id === peripheral.id)) return prev;
          return [...prev, { id: peripheral.id, name: peripheral.name }];
        });
      }
    );

    // when scan stops
    const subStopScan = bleEmitter.addListener(
      "BleManagerStopScan",
      () => {
        if (!mounted.current) return;
        setIsScanning(false);
        safeLog("Scan stopped.");
      }
    );

    // when devices disconnect
    const subDisconnect = bleEmitter.addListener(
      "BleManagerDisconnectPeripheral",
      ({ peripheral }: { peripheral: string }) => {
        if (!mounted.current) return;
        if (peripheral !== connectedIdRef.current) return;

        stopPolling();
        connectedIdRef.current = null;
        setConnectedId(null);
        setIsConnected(false);

        setFlow("-");
        setLiters("-");
        setFlow2("-");
        setLiters2("-");
        setVcc("-");

        safeLog("Device disconnected");
      }
    );

    return () => {
      mounted.current = false;
      stopPolling();
      subDiscover.remove();
      subStopScan.remove();
      subDisconnect.remove();
    };
  }, []);

  // -------------------------------------------------------
  // PERMISSIONS
  // -------------------------------------------------------
  async function ensurePerms() {
    if (Platform.OS === "android") {
      await PermissionsAndroid.requestMultiple([
        PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
        PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
        PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
      ]);
    }
  }

  // -------------------------------------------------------
  // SCAN & DEVICE LIST
  // -------------------------------------------------------
  const startScan = async () => {
    try {
      await ensurePerms();

      if (mounted.current) {
        setDevices([]);
        setIsScanning(true);
      }
      safeLog("Scanning for FluxmonEtiquetav2…");

      // scan for 10 seconds, no duplicates (we handle list ourselves)
      try {
        await BleManager.scan([], 10, false, {
          matchMode: 1,
          scanMode: 2,
          callbackType: 1,
        });
        safeLog("Scanning for FluxmonEtiquetav2…");
      } catch (error: any) {
        safeLog(`Scan error: ${error.message}`);
        stopScan();
      }


      // optional timeout (extra safety)
      setTimeout(() => {
        if (!mounted.current) return;
        if (isScanning) {
          safeLog("Scan timeout, stopping scan.");
          stopScan();
        }
      }, 10000);
    } catch (e: any) {
      Alert.alert("BLE error", e?.message ?? String(e));
      stopScan();
    }
  };

  const onDevicePress = (device: Peripheral) => {
    stopScan();
    safeLog(`Connecting to ${device.name} (${device.id})…`);
    connectTo(device.id);
  };

  // -------------------------------------------------------
  // CONNECT + DISCONNECT
  // -------------------------------------------------------
  const connectTo = async (id: string) => {
    try {
      stopPolling();

      safeLog("Connecting...");
      await BleManager.connect(id);
      await BleManager.retrieveServices(id);

      connectedIdRef.current = id;
      setConnectedId(id);
      setIsConnected(true);

      safeLog("Connected, reading static values…");
      await readStaticValues(id);

      // live polling
      startLivePolling(id);

      safeLog("Polling live data…");
    } catch (e: any) {
      safeLog(`Connect error: ${e?.message ?? e}`);
      stopPolling();
      connectedIdRef.current = null;
      setConnectedId(null);
      setIsConnected(false);
    }
  };

  // -------------------------------------------------------
  // READ STATIC VALUES
  // -------------------------------------------------------
  const readStaticValues = async (id: string) => {
    try {
      // SERIAL NUMBER
      const serialBytes: number[] = await BleManager.read(
        id,
        SERVICE_UUID,
        SERIAL_NUM_CHAR_UUID
      );
      const serialVal = Buffer.from(serialBytes).toString("utf8");
      if (mounted.current) setSerialNum(serialVal);

      // LOTE_VAL
      const loteBytes: number[] = await BleManager.read(
        id,
        SERVICE_UUID,
        LOTE_CHAR_UUID
      );
      const loteValRaw = Buffer.from(loteBytes).toString("utf8");
      const [loteStr, valStr] = loteValRaw.split("_");

      if (mounted.current) {
        setLote(loteStr ?? "-");
        setValidade(valStr ?? "-");
      }
    } catch (err: any) {
      safeLog("Error reading static data: " + err.message);
    }
  };

  // -------------------------------------------------------
  // LIVE POLLING (LITERS / FLOW / VCC)
  // -------------------------------------------------------
  const decodeFloatBuf = (buf: Buffer): number | null => {
    try {
      if (buf.length < 4) return null;

      const ab = new ArrayBuffer(4);
      const view = new DataView(ab);
      buf.forEach((v, i) => view.setUint8(i, v));

      return view.getFloat32(0, true); // little-endian
    } catch {
      return null;
    }
  };

  const startLivePolling = (id: string) => {
    stopPolling(); // just in case

    pollTimer.current = setInterval(async () => {
      if (!mounted.current || !connectedIdRef.current) {
        stopPolling();
        return;
      }

      try {
        // SENSOR 1: LITERS
        const litersBytes: number[] = await BleManager.read(
          id,
          SERVICE2_UUID,
          LITERS_CHAR_UUID
        );
        const litersVal = decodeFloatBuf(Buffer.from(litersBytes));
        if (litersVal !== null && mounted.current) {
          setLiters(litersVal.toFixed(3));
        }

        // SENSOR 1: FLOW
        const flowBytes: number[] = await BleManager.read(
          id,
          SERVICE2_UUID,
          FLOW_CHAR_UUID
        );
        const flowVal = decodeFloatBuf(Buffer.from(flowBytes));
        if (flowVal !== null && mounted.current) {
          setFlow(flowVal.toFixed(3));
        }

        // VCC
        const vccBytes: number[] = await BleManager.read(
          id,
          SERVICE2_UUID,
          VCC_CHAR_UUID
        );
        const vccVal = decodeFloatBuf(Buffer.from(vccBytes));
        if (vccVal !== null && mounted.current) {
          setVcc(vccVal.toFixed(3));
        }

        // SENSOR 2: LITERS
        const liters2Bytes: number[] = await BleManager.read(
          id,
          SERVICE3_UUID,
          LITERS2_CHAR_UUID
        );
        const litersVal2 = decodeFloatBuf(Buffer.from(liters2Bytes));
        if (litersVal2 !== null && mounted.current) {
          setLiters2(litersVal2.toFixed(3));
        }

        // SENSOR 2: FLOW
        const flow2Bytes: number[] = await BleManager.read(
          id,
          SERVICE3_UUID,
          FLOW2_CHAR_UUID
        );
        const flowVal2 = decodeFloatBuf(Buffer.from(flow2Bytes));
        if (flowVal2 !== null && mounted.current) {
          setFlow2(flowVal2.toFixed(3));
        }
      } catch (err: any) {
        // when you power off the board, reads will fail here
        safeLog("Poll error: " + err.message);
        // optional: stop polling if you want
        // stopPolling();
      }
    }, 500); // adjust if needed
  };

  // -------------------------------------------------------
  // RESET LITERS (WRITE 0x01)
  // sensorId = 1 or 2
  // -------------------------------------------------------
  const resetLiters = async (sensorId: 1 | 2) => {
    const id = connectedIdRef.current;
    if (!id) {
      Alert.alert("Not connected", "Connect to a device first.");
      return;
    }

    try {
      const charUuid =
        sensorId === 1 ? RESET_LITERS_CHAR_UUID : RESET_LITERS2_CHAR_UUID;

      // write single byte 0x01
      await BleManager.write(id, SERVICE4_UUID, charUuid, [1]);

      safeLog(`Reset command sent for sensor ${sensorId}.`);
      if (mounted.current) {
        if (sensorId === 1) setLiters("0.000");
        else setLiters2("0.000");
      }
    } catch (err: any) {
      Alert.alert("Reset error", err?.message ?? String(err));
    }
  };

  // -------------------------------------------------------
  // UI
  // -------------------------------------------------------
  return (
    <SafeAreaView
      style={{
        flex: 1,
        backgroundColor: "#000",
        paddingTop: 40,
        paddingHorizontal: 16,
      }}
    >
      {/* TOP BUTTONS */}
      <View
        style={{
          flexDirection: "row",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 16,
        }}
      >
        <TouchableOpacity
          onPress={startScan}
          style={{
            backgroundColor: isScanning ? "#ffaa00" : "#4c8bf5",
            paddingVertical: 12,
            paddingHorizontal: 16,
            borderRadius: 10,
          }}
        >
          <Text style={{ color: "#fff", fontWeight: "bold" }}>
            {isScanning ? "Scanning…" : "Scan Devices"}
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          onPress={() => resetLiters(1)}
          disabled={!isConnected}
          style={{
            backgroundColor: isConnected ? "#cc3333" : "#444",
            paddingVertical: 12,
            paddingHorizontal: 16,
            borderRadius: 10,
          }}
        >
          <Text style={{ color: "#fff", fontWeight: "bold" }}>
            Reset Liters
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          onPress={() => resetLiters(2)}
          disabled={!isConnected}
          style={{
            backgroundColor: isConnected ? "#cc3333" : "#444",
            paddingVertical: 12,
            paddingHorizontal: 16,
            borderRadius: 10,
          }}
        >
          <Text style={{ color: "#fff", fontWeight: "bold" }}>
            Reset Liters
          </Text>
        </TouchableOpacity>
      </View>

      {/* DEVICE LIST */}
      <Text style={{ color: "#fff", fontSize: 18, marginBottom: 8 }}>
        Devices ({DEVICE_NAME}):
      </Text>
      <FlatList
        style={{ maxHeight: 160, marginBottom: 16 }}
        data={devices}
        keyExtractor={(item) => item.id}
        ItemSeparatorComponent={() => (
          <View style={{ height: 1, backgroundColor: "#333" }} />
        )}
        renderItem={({ item }) => (
          <TouchableOpacity
            onPress={() => onDevicePress(item)}
            style={{
              paddingVertical: 8,
              paddingHorizontal: 10,
              backgroundColor: connectedId === item.id ? "#204020" : "#111",
            }}
          >
            <Text style={{ color: "#0f0", fontSize: 16 }}>
              {item.name ?? "Unknown"}
            </Text>
            <Text style={{ color: "#888", fontSize: 12 }}>{item.id}</Text>
          </TouchableOpacity>
        )}
        ListEmptyComponent={
          <Text style={{ color: "#555", fontStyle: "italic" }}>
            No devices found yet. Press "Scan Devices".
          </Text>
        }
      />

      {/* CONNECTION STATUS */}
      <Text
        style={{
          color: isConnected ? "#0f0" : "#f55",
          fontSize: 18,
          marginBottom: 10,
        }}
      >
        Status: {isConnected ? "Connected" : "Disconnected"}
      </Text>

      {/* STATIC INFO */}
      <Text style={{ color: "#ffe066", marginTop: 10, fontSize: 18 }}>
        Serial: {serialNum}
      </Text>
      <Text style={{ color: "#ffe066", marginTop: 6, fontSize: 18 }}>
        Lote: {lote}
      </Text>
      <Text style={{ color: "#ffe066", marginTop: 6, fontSize: 18 }}>
        Validade: {validade}
      </Text>

      {/* LIVE FLOATS */}
      <Text
        style={{
          color: isConnected ? "#f55" : "#888",
          marginTop: 24,
          fontSize: 24,
        }}
      >
        Vcc: {vcc} V
      </Text>

      <View
        style={{
          flexDirection: "row",
          justifyContent: "space-between",
          marginTop: 24,
        }}
      >
        {/* RIGHT COLUMN → SENSOR 1 */}
        <View style={{ flex: 1, marginLeft: 8 }}>
          <Text style={{ color: "#ffe066", fontSize: 22, marginBottom: 12 }}>
            SENSOR 1
          </Text>

          <Text
            style={{
              color: isConnected ? "#0f0" : "#888",
              marginBottom: 10,
              fontSize: 20,
            }}
          >
            Flow: {flow} L/min
          </Text>

          <Text
            style={{
              color: isConnected ? "#0f0" : "#888",
              marginBottom: 10,
              fontSize: 20,
            }}
          >
            Liters: {liters} L
          </Text>
        </View>

        {/* LEFT COLUMN → SENSOR 2 */}
        <View style={{ flex: 1, marginRight: 8 }}>
          <Text style={{ color: "#4da6ff", fontSize: 22, marginBottom: 12 }}>
            SENSOR 2
          </Text>

          <Text
            style={{
              color: isConnected ? "#0f0" : "#888",
              marginBottom: 10,
              fontSize: 20,
            }}
          >
            Flow2: {flow2} L/min
          </Text>

          <Text
            style={{
              color: isConnected ? "#0f0" : "#888",
              marginBottom: 10,
              fontSize: 20,
            }}
          >
            Liters2: {liters2} L
          </Text>
        </View>
      </View>

      {/* LOG */}
      <Text style={{ color: "#777", marginTop: 24 }}>{log}</Text>
    </SafeAreaView>
  );
}
