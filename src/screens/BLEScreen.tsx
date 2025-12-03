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

// SERVICE / CHARACTERISTICS
const SERVICE_UUID = "6E400000-B5A3-F393-E0A9-E50E24DCCA9E";
const LOTE_CHAR_UUID = "6E400001-B5A3-F393-E0A9-E50E24DCCA9E";
const SERIAL_NUM_CHAR_UUID = "6E400002-B5A3-F393-E0A9-E50E24DCCA9E";

const SERVICE2_UUID = "6E400010-B5A3-F393-E0A9-E50E24DCCA9E";
const LITERS_CHAR_UUID = "6E400011-B5A3-F393-E0A9-E50E24DCCA9E";
const FLOW_CHAR_UUID = "6E400012-B5A3-F393-E0A9-E50E24DCCA9E";
// NEW: reset liters characteristic (write a single byte 0x01)
const VCC_CHAR_UUID = "6E400013-B5A3-F393-E0A9-E50E24DCCA9E";

const SERVICE3_UUID = "6E400020-B5A3-F393-E0A9-E50E24DCCA9E";
const LITERS2_CHAR_UUID = "6E400021-B5A3-F393-E0A9-E50E24DCCA9E";
const FLOW2_CHAR_UUID = "6E400022-B5A3-F393-E0A9-E50E24DCCA9E";

const SERVICE4_UUID = "6E400030-B5A3-F393-E0A9-E50E24DCCA9E";
const RESET_LITERS_CHAR_UUID = "6E400031-B5A3-F393-E0A9-E50E24DCCA9E";
const RESET_LITERS2_CHAR_UUID = "6E400032-B5A3-F393-E0A9-E50E24DCCA9E";


export default function BLEScreen() {
  const ble = useRef(new BleManager()).current;
  const mounted = useRef(true);
  const connected = useRef<Device | null>(null);

  const disconnectSub = useRef<Subscription | null>(null);
  const pollTimer = useRef<NodeJS.Timer | null>(null);

  const [log, setLog] = useState("Idle");
  const [isConnected, setIsConnected] = useState(false);
  const [isScanning, setIsScanning] = useState(false);

  // list of found devices (only FluxmonEtiquetav2)
  const [devices, setDevices] = useState<Device[]>([]);

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

  const clearDisconnectSub = () => {
    try {
      disconnectSub.current?.remove();
    } catch { }
    disconnectSub.current = null;
  };

  const stopPolling = () => {
    if (pollTimer.current) {
      clearInterval(pollTimer.current);
      pollTimer.current = null;
    }
  };

  const stopScan = () => {
    try {
      ble.stopDeviceScan();
    } catch { }
    if (mounted.current) setIsScanning(false);
  };

  useEffect(() => {
    return () => {
      mounted.current = false;

      stopScan();
      stopPolling();
      clearDisconnectSub();

      (async () => {
        try {
          await connected.current?.cancelConnection();
        } catch { }
        ble.destroy();
      })();
    };
  }, []);

  // -------------------------------------------------------
  // PERMISSIONS + STATE
  // -------------------------------------------------------
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

  // -------------------------------------------------------
  // SCAN & DEVICE LIST
  // -------------------------------------------------------
  const startScan = async () => {
    try {
      await ensurePermsAndState();

      // reset list
      if (mounted.current) {
        setDevices([]);
        setIsScanning(true);
      }
      safeLog("Scanning for FluxmonEtiquetav2…");

      ble.startDeviceScan(null, { allowDuplicates: false }, (error, device) => {
        if (!mounted.current) return;

        if (error) {
          safeLog(`Scan error: ${error.message}`);
          stopScan();
          return;
        }

        if (!device?.name) return;
        if (device.name !== DEVICE_NAME) return;

        // add device if not already in the list
        setDevices((prev) => {
          if (prev.find((d) => d.id === device.id)) return prev;
          return [...prev, device];
        });
      });

      // optional timeout (10s)
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

  const onDevicePress = (device: Device) => {
    stopScan();
    safeLog(`Connecting to ${device.name} (${device.id})…`);
    connectTo(device);
  };

  // -------------------------------------------------------
  // CONNECT + DISCONNECT
  // -------------------------------------------------------
  const connectTo = async (device: Device) => {
    try {
      stopPolling();
      clearDisconnectSub();

      const d = await ble.connectToDevice(device.id, { autoConnect: false });
      connected.current = d;
      if (mounted.current) setIsConnected(true);

      safeLog("Connected, discovering services…");
      await d.discoverAllServicesAndCharacteristics();
      await new Promise((r) => setTimeout(r, 150));

      // watch disconnect
      disconnectSub.current = ble.onDeviceDisconnected(d.id, () => {
        connected.current = null;
        stopPolling();
        if (mounted.current) {
          safeLog("Device disconnected");
          setIsConnected(false);
        }
      });

      // static read
      await readStaticValues(d);

      // live polling
      startLivePolling(d);

      safeLog("Polling live data…");
    } catch (e: any) {
      safeLog(`Connect error: ${e?.message ?? e}`);
      connected.current = null;
      stopPolling();
      clearDisconnectSub();
      if (mounted.current) setIsConnected(false);
    }
  };

  // -------------------------------------------------------
  // READ STATIC VALUES
  // -------------------------------------------------------
  const readStaticValues = async (device: Device) => {
    try {
      // SERIAL NUMBER
      const serialChar = await device.readCharacteristicForService(
        SERVICE_UUID,
        SERIAL_NUM_CHAR_UUID
      );
      const serialVal = Buffer.from(serialChar.value ?? "", "base64").toString(
        "utf8"
      );
      if (mounted.current) setSerialNum(serialVal);

      // LOTE_VAL
      const loteChar = await device.readCharacteristicForService(
        SERVICE_UUID,
        LOTE_CHAR_UUID
      );
      const loteValRaw = Buffer.from(loteChar.value ?? "", "base64").toString(
        "utf8"
      );
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
  const startLivePolling = (device: Device) => {
    stopPolling(); // just in case

    pollTimer.current = setInterval(async () => {
      if (!mounted.current || !connected.current) {
        stopPolling();
        return;
      }

      try {
        // LITERS
        const litersChar = await device.readCharacteristicForService(
          SERVICE2_UUID,
          LITERS_CHAR_UUID
        );
        const litersVal = decodeFloat(litersChar);
        if (litersVal !== null && mounted.current) {
          setLiters(litersVal.toFixed(3));
        }

        // FLOW
        const flowChar = await device.readCharacteristicForService(
          SERVICE2_UUID,
          FLOW_CHAR_UUID
        );
        const flowVal = decodeFloat(flowChar);
        if (flowVal !== null && mounted.current) {
          setFlow(flowVal.toFixed(3));
        }

        // VCC
        const vccChar = await device.readCharacteristicForService(
          SERVICE2_UUID,
          VCC_CHAR_UUID
        );
        const vccVal = decodeFloat(vccChar);
        if (vccVal !== null && mounted.current) {
          setVcc(vccVal.toFixed(3));
        }

        // LITERS02
        const litersChar2 = await device.readCharacteristicForService(
          SERVICE3_UUID,
          LITERS2_CHAR_UUID
        );
        const litersVal2 = decodeFloat(litersChar2);
        if (litersVal2 !== null && mounted.current) {
          setLiters2(litersVal2.toFixed(3));
        }

        // FLOW
        const flowChar2 = await device.readCharacteristicForService(
          SERVICE3_UUID,
          FLOW2_CHAR_UUID
        );
        const flowVal2 = decodeFloat(flowChar2);
        if (flowVal2 !== null && mounted.current) {
          setFlow2(flowVal2.toFixed(3));
        }

      } catch (err: any) {
        // when you power off the board, reads will fail here
        safeLog("Poll error: " + err.message);
      }
    }, 500); // adjust if needed
  };

  // -------------------------------------------------------
  // RESET LITERS (WRITE 0x01)
  // ou 01 ou 02
  // RESET_LITERS_CHAR_UUID ou RESET_LITERS2_CHAR_UUID
  // -------------------------------------------------------
  // sensorId = 1 ou 2
  const resetLiters = async (sensorId) => {
    if (!connected.current) {
      Alert.alert("Not connected", "Connect to a device first.");
      return;
    }

    try {
      const dev = connected.current;
      const payload = Buffer.from([1]).toString("base64");

      await dev.writeCharacteristicWithResponseForService(
        SERVICE4_UUID,
        sensorId == 1 ? RESET_LITERS_CHAR_UUID : RESET_LITERS2_CHAR_UUID,
        payload
      );

      safeLog("Reset command sent.");
      if (mounted.current) setLiters("0.000");
    } catch (err: any) {
      Alert.alert("Reset error", err?.message ?? String(err));
    }
  };

  // -------------------------------------------------------
  // HELPERS
  // -------------------------------------------------------
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
          <Text style={{ color: "#fff", fontWeight: "bold" }}>Reset Liters</Text>
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
          <Text style={{ color: "#fff", fontWeight: "bold" }}>Reset Liters</Text>
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
              backgroundColor:
                connected.current?.id === item.id ? "#204020" : "#111",
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
