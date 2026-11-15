const LED_POSITIONS = [[0, 0], [1, 0], [2, 0]];
const REPORT_LENGTH = 64;
const REPORT_ID = 0x21;
const ECHO = 0x03;
const COMMAND = 0x27;
const INFO_COMMAND = 0x00;
const EXPECTED_MODEL = 0x0004;

let previousPacket = null;
let modelVerified = false;

export function Name() {
    return "SayoDevice O3C";
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
    return "https://raw.githubusercontent.com/slinkybuky/o3c-signalrgb/main/icons/SayoDevice_O3C.png";
}

export function DeviceType() {
    return "Keyboard";
}

export function Type() {
    return "hid";
}

export function Size() {
    return [3, 1];
}

export function LedNames() {
    return ["Key 1", "Key 2", "Key 3"];
}

export function LedPositions() {
    return LED_POSITIONS;
}

export function Validate(endpoint) {
    return endpoint.usage_page === 0xFF11 &&
           endpoint.usage === 0x0002;
}

function buildPacket(command, index, data) {
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

    packet[2] = 0;
    packet[3] = 0;

    let sum = 0;

    for (let i = 0; i < REPORT_LENGTH; i += 2) {
        sum += packet[i] | ((packet[i + 1] ?? 0) << 8);
    }

    sum &= 0xFFFF;

    packet[2] = sum & 0xFF;
    packet[3] = (sum >> 8) & 0xFF;

    return packet;
}

function readModelInfo() {
    if (typeof device.read !== "function") {
        device.log("Model verification failed: device.read() unavailable");
        return false;
    }

    try {
        if (typeof device.clearReadBuffer === "function") {
            device.clearReadBuffer();
        }

        const request = buildPacket(INFO_COMMAND, 0x00, []);
        device.write(request, REPORT_LENGTH);

        device.log("Info request sent");

        for (let attempt = 0; attempt < 3; attempt++) {
            const response = device.read([REPORT_ID], REPORT_LENGTH, 100);

            if (!response || response.length < 12) {
                device.log("Info read " + (attempt + 1) + ": no response");
                continue;
            }

            device.log("Info response: " + response.slice(0, 20).map(v =>
                (v & 0xFF).toString(16).padStart(2, "0")
            ).join(" "));

            let offset = -1;

            if (response[0] === REPORT_ID && response[1] === ECHO) {
                offset = 4;
            } else if (response[0] === ECHO) {
                offset = 3;
            }

            if (offset < 0 || offset + 7 >= response.length) continue;

            const header = response[offset] | (response[offset + 1] << 8);
            const status = header >>> 10;
            const length = header & 0x3FF;
            const command = response[offset + 2];

            if (length < 12 || command !== INFO_COMMAND ||
                (status !== 0 && status !== 1)) {
                continue;
            }

            const model = response[offset + 4] |
                          (response[offset + 5] << 8);

            const firmware = response[offset + 6] |
                             (response[offset + 7] << 8);

            device.log("Detected model: 0x" + model.toString(16).padStart(4, "0"));
            device.log("Firmware: 0x" + firmware.toString(16).padStart(4, "0"));

            return model === EXPECTED_MODEL;
        }
    } catch (error) {
        device.log("Model verification error: " + error);
    }

    device.log("Model verification failed");
    return false;
}

function buildLightingPacket(colors) {
    const data = [];

    for (let i = 0; i < 3; i++) {
        const color = colors[i] || [0, 0, 0];
        data.push(
            color[0] & 0xFF,
            color[1] & 0xFF,
            color[2] & 0xFF,
            0xFF
        );
    }

    return buildPacket(COMMAND, 0x00, data);
}

export function Initialize() {
    previousPacket = null;
    modelVerified = false;

    device.log("Verifying SayoDevice O3C identity...");

    modelVerified = readModelInfo();

    if (modelVerified) {
        device.log("SayoDevice O3C verified and initialized");
    } else {
        device.log("SayoDevice O3C rejected: lighting disabled");
    }
}

export function Render() {
    if (!modelVerified) return;

    const colors = [
        device.color(0, 0),
        device.color(1, 0),
        device.color(2, 0)
    ];

    const packet = buildLightingPacket(colors);

    if (previousPacket !== null &&
        packet.every((value, index) => value === previousPacket[index])) {
        return;
    }

    device.write(packet, REPORT_LENGTH);
    previousPacket = packet;
}

export function Shutdown() {
    previousPacket = null;
    modelVerified = false;
}
