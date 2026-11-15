const REPORT_LENGTH = 64;
const REPORT_ID = 0x21;
const ECHO = 0x03;

const INFO_COMMAND = 0x00;
const LIGHTING_COMMAND = 0x27;

const DEVICES = {
    0x0005: {
        name: "SayoDevice O3C",
        type: "Keyboard",
        image: "https://raw.githubusercontent.com/slinkybuky/sayo-signalrgb/main/icons/SayoDevice_O3C.png",
        layout: {
            size: [3, 1],
            names: ["Key 1", "Key 2", "Key 3"],
            positions: [[0, 0], [1, 0], [2, 0]],
            leds: [0, 1, 2]
        }
    },

    0x0009: {
        name: "SayoDevice O3C++",
        type: "Keyboard",
        image: "https://raw.githubusercontent.com/slinkybuky/sayo-signalrgb/main/icons/SayoDevice_O3C_PP.png",
        layout: {
            size: [4, 1],
            names: ["Key 1", "Key 2", "Key 3", "Key 4"],
            positions: [[0, 0], [1, 0], [2, 0], [3, 0]],
            leds: [0, 1, 2, 3]
        }
    },

    unknown: {
        name: "Unknown SayoDevice",
        type: "Keyboard",
        image: "https://raw.githubusercontent.com/slinkybuky/sayo-signalrgb/main/icons/Unknown_SayoDevice.png",
        layout: {
            size: [1, 1],
            names: ["LED 1"],
            positions: [[0, 0]],
            leds: [0]
        }
    }
};

let deviceConfig = null;
let detectedModel = null;
let detectedFirmware = null;
let previousPacket = null;

export function Name() {
    return "SayoDevice";
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

export function DeviceType() {
    return "Keyboard";
}

export function Type() {
    return "hid";
}

export function Validate(endpoint) {
    return endpoint.usage_page === 0xFF11 &&
           endpoint.usage === 0x0002;
}

function buildPacket(command, index, data) {
    if (data.length > REPORT_LENGTH - 8) {
        throw new Error("Packet payload exceeds report capacity");
    }

    const packet = new Array(REPORT_LENGTH).fill(0);

    packet[0] = REPORT_ID;
    packet[1] = ECHO;

    const length = data.length + 4;

    packet[4] = length & 0xFF;
    packet[5] = (length >> 8) & 0xFF;
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

    let offset;

    if (response[0] === REPORT_ID && response[1] === ECHO) {
        offset = 4;
    } else if (response[0] === ECHO) {
        offset = 3;
    } else {
        return null;
    }

    if (response.length < offset + 8) {
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

    return {
        model: response[offset + 4] |
               (response[offset + 5] << 8),

        firmware: response[offset + 6] |
                  (response[offset + 7] << 8)
    };
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
        device.log("Request: " + formatBytes(request.slice(0, 8)));

        device.write(request, REPORT_LENGTH);

        for (let attempt = 0; attempt < 20; attempt++) {
            const response = device.read(
                [REPORT_ID],
                REPORT_LENGTH,
                250
            );

            if (!response || response.length === 0) {
                continue;
            }

            const bytes = Array.from(response, value => value & 0xFF);
            const info = parseModelInfo(bytes);

            if (info) {
                device.log("Valid info response received");
                return info;
            }

            device.log(
                "Ignoring unrelated HID response: " +
                formatBytes(bytes.slice(0, 8))
            );
        }
    } catch (error) {
        device.log("Identification error: " + error);
    }

    device.log("No valid model-info response received");
    return null;
}

function formatBytes(bytes) {
    return bytes.map(value =>
        value.toString(16).padStart(2, "0")
    ).join(" ");
}

function validateLayout(config) {
    if (!config || !config.layout) {
        return false;
    }

    const layout = config.layout;

    if (
        !Array.isArray(layout.size) ||
        layout.size.length !== 2 ||
        !Array.isArray(layout.names) ||
        !Array.isArray(layout.positions) ||
        !Array.isArray(layout.leds)
    ) {
        return false;
    }

    const count = layout.names.length;

    if (
        count === 0 ||
        layout.positions.length !== count ||
        layout.leds.length !== count
    ) {
        return false;
    }

    const [width, height] = layout.size;

    if (
        !Number.isInteger(width) ||
        !Number.isInteger(height) ||
        width < 1 ||
        height < 1
    ) {
        return false;
    }

    const usedPositions = new Set();
    const usedLeds = new Set();

    for (let i = 0; i < count; i++) {
        const position = layout.positions[i];
        const led = layout.leds[i];

        if (
            !Array.isArray(position) ||
            position.length !== 2 ||
            !Number.isInteger(position[0]) ||
            !Number.isInteger(position[1]) ||
            position[0] < 0 ||
            position[0] >= width ||
            position[1] < 0 ||
            position[1] >= height
        ) {
            return false;
        }

        if (!Number.isInteger(led) || led < 0 || led > 255) {
            return false;
        }

        const positionKey = position.join(",");
        
        if (usedPositions.has(positionKey) || usedLeds.has(led)) {
            return false;
        }

        usedPositions.add(positionKey);
        usedLeds.add(led);
    }

    return true;
}

function applyDeviceConfig(config) {
    if (!validateLayout(config)) {
        device.log("Invalid device layout configuration");
        return false;
    }

    try {
        device.setName(config.name);
        device.setSize(config.layout.size);
        device.setControllableLeds(
            config.layout.names,
            config.layout.positions
        );
        device.setImageFromUrl(config.image);

        deviceConfig = config;
        previousPacket = null;

        device.log("Applied device configuration: " + config.name);
        return true;
    } catch (error) {
        deviceConfig = null;
        device.log("Failed to apply device configuration: " + error);
        return false;
    }
}

function buildLightingPacket(colors) {
    const data = [];
    const ledCount = deviceConfig.layout.leds.length;

    const orderedColors = new Array(ledCount).fill(null);

    for (let i = 0; i < ledCount; i++) {
        orderedColors[deviceConfig.layout.leds[i]] = colors[i];
    }

    for (let i = 0; i < ledCount; i++) {
        const color = orderedColors[i] || [0, 0, 0];

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
    deviceConfig = null;
    detectedModel = null;
    detectedFirmware = null;
    previousPacket = null;

    device.log("Identifying SayoDevice...");

    const info = readModelInfo();

    if (!info) {
        device.log("Device identification unsuccessful");
        return;
    }

    detectedModel = info.model;
    detectedFirmware = info.firmware;

    device.log(
        "Model: 0x" + detectedModel.toString(16).padStart(4, "0")
    );

    device.log(
        "Firmware: 0x" + detectedFirmware.toString(16).padStart(4, "0")
    );

    const config = DEVICES[detectedModel] || DEVICES.unknown;

    if (config === DEVICES.unknown) {
        device.log(
            "Unrecognized SayoDevice model: 0x" +
            detectedModel.toString(16).padStart(4, "0")
        );
    }

    if (!applyDeviceConfig(config)) {
        device.log("Device initialization failed");
        return;
    }

    device.log("Initialized: " + config.name);
    device.log("LED count: " + config.layout.leds.length);
    device.log("Size: " + config.layout.size.join("x"));
    device.log("LED names: " + config.layout.names.join(", "));
    device.log(
        "LED positions: " + JSON.stringify(config.layout.positions)
    );
    device.log(
        "LED mapping: " + JSON.stringify(config.layout.leds)
    );
}

export function Render() {
    if (!deviceConfig) {
        return;
    }

    const layout = deviceConfig.layout;
    const colors = [];

    for (let i = 0; i < layout.positions.length; i++) {
        const [x, y] = layout.positions[i];
        const color = device.color(x, y);

        colors.push(color || [0, 0, 0]);
    }

    const packet = buildLightingPacket(colors);

    if (
        previousPacket !== null &&
        packet.every((value, index) =>
            value === previousPacket[index]
        )
    ) {
        return;
    }

    device.write(packet, REPORT_LENGTH);
    previousPacket = packet;
}

export function Shutdown() {
    try {
        const offColors = Array.from(
            { length: 14 },
            () => [0x00, 0x00, 0x00]
        );

        const packet = buildPacket(
            LIGHTING_COMMAND,
            0x00,
            offColors.flatMap(() => [0x00, 0x00, 0x00, 0xFF])
        );

        device.write(packet, REPORT_LENGTH);
        device.log("Sent shutdown packet: all LED slots off");
    } catch (error) {
        device.log("Failed to turn off LEDs: " + error);
    }

    previousPacket = null;
    deviceConfig = null;
    detectedModel = null;
    detectedFirmware = null;
}