const LED_POSITIONS = [[0, 0], [1, 0], [2, 0], [3, 0]];
const REPORT_LENGTH = 64;
const REPORT_ID = 0x02;
const COMMAND = 0x69;
const PAYLOAD_LENGTH = 0x10;
const INFO_REPORT_ID = 0x21;
const INFO_COMMAND = 0x00;
const EXPECTED_MODEL = 0x0006;

let previousColors = null;
let echoIndex = 0;
let modelVerified = false;

export function Name() {
    return "SayoDevice O3C++";
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
    return "https://raw.githubusercontent.com/slinkybuky/o3c-signalrgb/main/icons/SayoDevice_O3C_PP.png";
}

export function DeviceType() {
    return "Keyboard";
}

export function Type() {
    return "hid";
}

export function Size() {
    return [4, 1];
}

export function LedNames() {
    return ["Key 1", "Key 2", "Key 3", "Key 4"];
}

export function LedPositions() {
    return LED_POSITIONS;
}

export function Validate(endpoint) {
    return endpoint.interface === 1;
}

function buildInfoRequest() {
    const packet = new Array(64).fill(0);

    packet[0] = INFO_REPORT_ID;
    packet[1] = 0x03;
    packet[4] = 0x04;
    packet[5] = 0x00;
    packet[6] = INFO_COMMAND;
    packet[7] = 0x00;

    let sum = 0;

    for (let i = 0; i < packet.length; i += 2) {
        sum += packet[i] | ((packet[i + 1] ?? 0) << 8);
    }

    sum &= 0xFFFF;
    packet[2] = sum & 0xFF;
    packet[3] = (sum >> 8) & 0xFF;

    return packet;
}

function verifyModel() {
    if (typeof device.read !== "function") {
        device.log("Model verification failed: device.read() unavailable");
        return false;
    }

    try {
        if (typeof device.clearReadBuffer === "function") {
            device.clearReadBuffer();
        }

        device.write(buildInfoRequest(), 64);
        device.log("O3C++ Info request sent");

        for (let attempt = 0; attempt < 3; attempt++) {
            const response = device.read([INFO_REPORT_ID], 64, 100);

            if (!response || response.length < 12) {
                device.log("Info read " + (attempt + 1) + ": no response");
                continue;
            }

            device.log("Info response: " + response.slice(0, 20).map(v =>
                (v & 0xFF).toString(16).padStart(2, "0")
            ).join(" "));

            let offset = -1;

            if (response[0] === INFO_REPORT_ID && response[1] === 0x03) {
                offset = 4;
            } else if (response[0] === 0x03) {
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

            device.log("Detected model: 0x" +
                model.toString(16).padStart(4, "0"));

            device.log("Firmware: 0x" +
                firmware.toString(16).padStart(4, "0"));

            if (model !== EXPECTED_MODEL) {
                device.log("Model mismatch: expected O3C++ (0x0006)");
                return false;
            }

            return true;
        }
    } catch (error) {
        device.log("Model verification error: " + error);
    }

    device.log("Model verification failed: no valid Info response");
    return false;
}

function buildPacket(colors) {
    const packet = new Array(REPORT_LENGTH).fill(0);

    packet[0] = REPORT_ID;
    packet[1] = COMMAND;
    packet[2] = PAYLOAD_LENGTH;
    packet[3] = echoIndex & 0xFF;

    for (let i = 0; i < 12; i++) {
        packet[4 + i] = colors[i];
    }

    packet[0x13] = packet
        .slice(0, 0x13)
        .reduce((sum, value) => sum + value, 0) & 0xFF;

    packet[0x20] = COMMAND;

    return packet;
}

function drainInput() {
    for (let i = 0; i < 8; i++) {
        device.read([], REPORT_LENGTH, 0);

        if (typeof device.getLastReadSize === "function" &&
            device.getLastReadSize() <= 0) {
            break;
        }
    }
}

export function Initialize() {
    previousColors = null;
    echoIndex = 0;
    modelVerified = false;

    device.log("Verifying SayoDevice O3C++ identity...");

    modelVerified = verifyModel();

    if (!modelVerified) {
        device.log("SayoDevice O3C++ rejected: lighting disabled");
        return;
    }

    drainInput();
    device.log("SayoDevice O3C++ verified and initialized");
}

export function Render() {
    if (!modelVerified) return;

    const colors = [];

    for (let i = 0; i < 4; i++) {
        colors.push(...device.color(i, 0));
    }

    if (previousColors !== null &&
        colors.every((value, index) => value === previousColors[index])) {
        return;
    }

    echoIndex = (echoIndex + 1) & 0xFF;

    const packet = buildPacket(colors);

    drainInput();
    device.write(packet, REPORT_LENGTH);

    previousColors = colors.slice();
}

export function Shutdown() {
    previousColors = null;
    modelVerified = false;
}
