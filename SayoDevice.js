const REPORT_LENGTH = 64;
const REPORT_ID = 0x21;
const ECHO = 0x03;
const LIGHTING_COMMAND = 0x27;
const INFO_COMMAND = 0x00;

const DEVICES = {
    o3c: {
        model: 0x0004,
        name: "SayoDevice O3C",
        type: "Keyboard",
        image: "https://raw.githubusercontent.com/slinkybuky/sayo-signalrgb/main/icons/SayoDevice_O3C.png",
        size: [3, 1],
        ledNames: ["Key 1", "Key 2", "Key 3"],
        ledPositions: [[0, 0], [1, 0], [2, 0]],
        ledCount: 3
    },
    o3c_pp: {
        model: 0x0009,
        name: "SayoDevice O3C++",
        type: "Keyboard",
        image: "https://raw.githubusercontent.com/slinkybuky/sayo-signalrgb/main/icons/SayoDevice_O3C_PP.png",
        size: [4, 1],
        ledNames: ["Key 1", "Key 2", "Key 3", "Key 4"],
        ledPositions: [[0, 0], [1, 0], [2, 0], [3, 0]],
        ledCount: 4
    },
    unknown: {
        model: null,
        name: "Unknown SayoDevice",
        type: "Keyboard",
        image: "https://raw.githubusercontent.com/slinkybuky/sayo-signalrgb/main/icons/Unknown_SayoDevice.png",
        size: [1, 1],
        ledNames: ["LED 1"],
        ledPositions: [[0, 0]],
        ledCount: 1
    }
};

let deviceConfig;
let detectedModel;
let detectedFirmware;
let previousPacket;

export function Name() {
    return deviceConfig?.name;
}

export function Publisher() {
    return "slinkybuky";
}

export function VendorId() {
    return 0x8089;
}

export function ProductId() {
    return 0x0009;
}

export function ImageUrl() {
    return deviceConfig?.image;
}

export function DeviceType() {
    return deviceConfig?.type;
}

export function Type() {
    return "hid";
}

export function Size() {
    return deviceConfig?.size;
}

export function LedNames() {
    return deviceConfig?.ledNames;
}

export function LedPositions() {
    return deviceConfig?.ledPositions;
}

export function Validate(endpoint) {
    return endpoint.usage_page === 0xFF11 &&
           endpoint.usage === 0x0002;
}

function buildPacket(command, index, data) {
    const packet = new Array(REPORT_LENGTH).fill(0);

    packet[0] = REPORT_ID;
    packet[1] = ECHO;
    packet[4] = (data.length + 4) & 0xFF;
    packet[5] = ((data.length + 4) >> 8) & 0xFF;
    packet[6] = command;
    packet[7] = index;

    for (let i = 0; i < data.length; i++) {
        packet[8 + i] = data[i] & 0xFF;
    }

    let checksum = 0;

    for (let i = 0; i < REPORT_LENGTH; i += 2) {
        checksum += packet[i] | (packet[i + 1] << 8);
    }

    checksum &= 0xFFFF;
    packet[2] = checksum & 0xFF;
    packet[3] = (checksum >> 8) & 0xFF;

    return packet;
}

function parseModelInfo(response) {
    if (!response || response.length < 12) {
        return null;
    }

    let offset = -1;

    if (response[0] === REPORT_ID && response[1] === ECHO) {
        offset = 4;
    } else if (response[0] === ECHO) {
        offset = 3;
    }

    if (offset < 0 || response.length < offset + 8) {
        return null;
    }

    const header = response[offset] |
                   (response[offset + 1] << 8);

    const status = header >>> 10;
    const length = header & 0x03FF;
    const command = response[offset + 2];

    if (
        length < 12 ||
        length > REPORT_LENGTH - offset ||
        command !== INFO_COMMAND ||
        (status !== 0 && status !== 1)
    ) {
        return null;
    }

    const model = response[offset + 4] |
                  (response[offset + 5] << 8);

    const firmware = response[offset + 6] |
                     (response[offset + 7] << 8);

    return { model, firmware };
}

function readModelInfo() {
    if (typeof device.read !== "function") {
        device.log("Identification failed: device.read() unavailable");
        return null;
    }

    try {
        if (typeof device.clearReadBuffer === "function") {
            device.clearReadBuffer();
        }

        const request = buildPacket(INFO_COMMAND, 0x00, []);

        device.log("Sending SayoDevice info request");
        device.log("Request: " + request.slice(0, 8).map(v =>
            v.toString(16).padStart(2, "0")
        ).join(" "));

        device.write(request, REPORT_LENGTH);

        for (let attempt = 0; attempt < 20; attempt++) {
            const response = device.read([REPORT_ID], REPORT_LENGTH, 250);

            if (!response || response.length === 0) {
                continue;
            }

            const bytes = Array.from(response).map(v => v & 0xFF);
            const info = parseModelInfo(bytes);

            if (info !== null) {
                device.log("Valid info response received");
                device.log("Model: 0x" +
                    info.model.toString(16).padStart(4, "0"));
                device.log("Firmware: 0x" +
                    info.firmware.toString(16).padStart(4, "0"));

                return info;
            }

            device.log("Ignoring unrelated HID response: " +
                bytes.slice(0, 8).map(v =>
                    v.toString(16).padStart(2, "0")
                ).join(" "));
        }
    } catch (error) {
        device.log("Identification error: " + error);
    }

    device.log("No valid model-info response received");
    return null;
}

function findDevice(model) {
    for (const config of Object.values(DEVICES)) {
        if (config.model === model) {
            return config;
        }
    }

    return DEVICES.unknown;
}

function buildLightingPacket(colors) {
    const data = [];

    for (let i = 0; i < deviceConfig.ledCount; i++) {
        const color = colors[i] || [0, 0, 0];

        data.push(
            color[0] & 0xFF,
            color[1] & 0xFF,
            color[2] & 0xFF,
            0xFF
        );
    }

    return buildPacket(LIGHTING_COMMAND, 0x00, data);
}

export function Initialize() {
    deviceConfig = undefined;
    detectedModel = undefined;
    detectedFirmware = undefined;
    previousPacket = undefined;

    device.log("Identifying SayoDevice...");

    const info = readModelInfo();

    if (info === null) {
        device.log("Device identification unsuccessful");
        return;
    }

    detectedModel = info.model;
    detectedFirmware = info.firmware;
    deviceConfig = findDevice(detectedModel);

    if (deviceConfig === DEVICES.unknown) {
        device.log("Unrecognized model; using generic configuration");
    }

    device.log("Initialized: " + deviceConfig.name);
    device.log("Model ID: 0x" +
        detectedModel.toString(16).padStart(4, "0"));
    device.log("Firmware: 0x" +
        detectedFirmware.toString(16).padStart(4, "0"));
    device.log("LED count: " + deviceConfig.ledCount);
    device.log("Size: " + deviceConfig.size.join("x"));
}

export function Render() {
    if (!deviceConfig) {
        return;
    }

    const colors = [];

    for (let i = 0; i < deviceConfig.ledCount; i++) {
        colors.push(device.color(i, 0));
    }

    const packet = buildLightingPacket(colors);

    if (
        previousPacket !== undefined &&
        packet.every((value, index) => value === previousPacket[index])
    ) {
        return;
    }

    device.write(packet, REPORT_LENGTH);
    previousPacket = packet;
}

export function Shutdown() {
    previousPacket = undefined;
    deviceConfig = undefined;
    detectedModel = undefined;
    detectedFirmware = undefined;
}