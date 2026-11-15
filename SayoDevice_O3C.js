const REPORT_LENGTH = 64;
const REPORT_ID = 0x21;
const REPORT_ID_HIGH_SPEED = 0x22;
const ECHO = 0x03;
const COMMAND_LED = 0x27;
const COMMAND_INFO = 0x00;
const COMMAND_SYSINFO = 0x02;
const MAX_LEDS = 255;

const DEVICE_PROFILES = {
    0x0009: {
        name: "SayoDevice O3C",
        modelCode: 0x0004,
        ledCount: 3,
        positions: [[0, 0], [1, 0], [2, 0]]
    }
};

let previousColors = null;
let activeProfile = null;
let deviceInfo = null;

function log(message) {
    device.log("[SayoDevice] " + message);
}

function buildPacket(command, index, data, length) {
    const packet = new Array(length).fill(0);

    packet[0] = length === 1024
        ? REPORT_ID_HIGH_SPEED
        : REPORT_ID;

    packet[1] = ECHO;

    const entityLength = data.length + 4;

    packet[4] = entityLength & 0xFF;
    packet[5] = (entityLength >> 8) & 0xFF;
    packet[6] = command;
    packet[7] = index & 0xFF;

    for (let i = 0; i < data.length; i++) {
        packet[8 + i] = data[i] & 0xFF;
    }

    let sum = 0;

    for (let i = 0; i < length; i += 2) {
        sum += packet[i] | ((packet[i + 1] || 0) << 8);
    }

    sum &= 0xFFFF;

    packet[2] = sum & 0xFF;
    packet[3] = (sum >> 8) & 0xFF;

    return packet;
}

function readReply(length) {
    const buffer = new Array(length).fill(0);

    try {
        const result = device.read(buffer, length);

        if (Array.isArray(result)) {
            return result;
        }

        if (typeof result === "number" && result > 0) {
            return buffer;
        }

        if (typeof device.getLastReadSize === "function" &&
            device.getLastReadSize() > 0) {
            return buffer;
        }
    } catch (error) {
        log("Read failed: " + error);
    }

    return null;
}

function parseReply(buffer) {
    if (!buffer) return null;

    let offset = -1;

    if (buffer[0] === REPORT_ID && buffer[1] === ECHO) {
        offset = 4;
    } else if (buffer[0] === ECHO) {
        offset = 3;
    }

    if (offset < 0 || offset + 3 >= buffer.length) {
        return null;
    }

    const header = buffer[offset] |
        (buffer[offset + 1] << 8);

    const status = header >>> 10;
    const length = header & 0x3FF;

    if (length < 4) return null;

    return {
        status,
        command: buffer[offset + 2],
        index: buffer[offset + 3],
        data: buffer.slice(offset + 4, offset + length)
    };
}

function request(command, index, length = REPORT_LENGTH) {
    const packet = buildPacket(command, index, [], length);

    for (let attempt = 0; attempt < 2; attempt++) {
        try {
            device.write(packet, length);
        } catch (error) {
            log("Command 0x" + command.toString(16) +
                " write failed: " + error);
            return null;
        }

        for (let i = 0; i < 4; i++) {
            const reply = parseReply(readReply(length));

            if (reply && reply.command === command) {
                return reply;
            }
        }
    }

    return null;
}

function readDeviceInfo() {
    log("Requesting device information...");

    const info = request(COMMAND_INFO);

    if (!info || info.status > 1 || info.data.length < 4) {
        log("Could not retrieve device information");
        return null;
    }

    const modelCode = info.data[0] |
        (info.data[1] << 8);

    const firmware = info.data[2] |
        (info.data[3] << 8);

    const supportedCommands = info.data.slice(8);

    log("Model code: 0x" + modelCode.toString(16).padStart(4, "0"));
    log("Firmware: 0x" + firmware.toString(16).padStart(4, "0"));
    log("Supported commands: " +
        supportedCommands.map(x => "0x" + x.toString(16)).join(", "));

    const sysinfo = request(COMMAND_SYSINFO);

    let vendorId = 0x8089;
    let productId = ProductId();

    if (sysinfo && sysinfo.status <= 1 && sysinfo.data.length >= 16) {
        vendorId = sysinfo.data[12] |
            (sysinfo.data[13] << 8);

        productId = sysinfo.data[14] |
            (sysinfo.data[15] << 8);

        log("Reported VID: 0x" + vendorId.toString(16).padStart(4, "0"));
        log("Reported PID: 0x" + productId.toString(16).padStart(4, "0"));
    } else {
        log("SysInfo unavailable; using plugin USB identifiers");
    }

    return {
        modelCode,
        firmware,
        vendorId,
        productId,
        supportedCommands,
        supportsLEDCommand: supportedCommands.includes(COMMAND_LED)
    };
}

function detectLEDCount() {
    let count = 0;

    for (let index = 0; index < MAX_LEDS;) {
        const reply = request(COMMAND_LED, index);

        if (!reply || reply.status > 1) {
            break;
        }

        const returned = Math.floor(reply.data.length / 4);

        if (returned <= 0) {
            break;
        }

        count += returned;
        index += returned;
    }

    return Math.min(count, MAX_LEDS);
}

function selectProfile(info) {
    let profile = null;

    if (info) {
        profile = DEVICE_PROFILES[info.productId];

        if (!profile) {
            for (const pid in DEVICE_PROFILES) {
                if (DEVICE_PROFILES[pid].modelCode === info.modelCode) {
                    profile = DEVICE_PROFILES[pid];
                    break;
                }
            }
        }
    }

    if (profile) {
        activeProfile = Object.assign({}, profile);
        log("Matched profile: " + profile.name);
    } else {
        activeProfile = {
            name: info
                ? "SayoDevice 0x" + info.modelCode.toString(16).padStart(4, "0")
                : "SayoDevice (Unknown)",
            modelCode: info ? info.modelCode : 0,
            ledCount: 0,
            positions: null
        };

        log("Unknown model; using generic profile");
    }

    if (info && info.supportsLEDCommand && activeProfile.ledCount === 0) {
        const detected = detectLEDCount();

        if (detected > 0) {
            activeProfile.ledCount = detected;
            log("Detected " + detected + " LEDs");
        }
    }

    if (!activeProfile.ledCount) {
        activeProfile.ledCount = 3;
        log("Using fallback LED count: 3");
    }

    if (!activeProfile.positions) {
        activeProfile.positions = [];

        for (let i = 0; i < activeProfile.ledCount; i++) {
            activeProfile.positions.push([i, 0]);
        }
    }

    if (typeof device.setName === "function") {
        try {
            device.setName(activeProfile.name);
        } catch (error) {
            log("Could not dynamically set device name: " + error);
        }
    }

    log("Selected " + activeProfile.name +
        " with " + activeProfile.ledCount + " LEDs");
}

export function Name() {
    return "SayoDevice Universal";
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
    const count = activeProfile
        ? activeProfile.ledCount
        : 3;

    return [count, 1];
}

export function LedNames() {
    const count = activeProfile
        ? activeProfile.ledCount
        : 3;

    return Array.from(
        { length: count },
        (_, i) => "LED " + (i + 1)
    );
}

export function LedPositions() {
    return activeProfile
        ? activeProfile.positions
        : [[0, 0], [1, 0], [2, 0]];
}

export function Validate(endpoint) {
    return endpoint.usage_page === 0xFF11 &&
        endpoint.usage === 0x0002;
}

export function Initialize() {
    previousColors = null;
    activeProfile = null;

    log("Initializing universal plugin");

    deviceInfo = readDeviceInfo();

    if (deviceInfo && !deviceInfo.supportsLEDCommand) {
        log("This device does not advertise command 0x27");
        return;
    }

    selectProfile(deviceInfo);
}

export function Render() {
    if (!activeProfile) return;

    const count = activeProfile.ledCount;
    const colors = [];

    for (let i = 0; i < count; i++) {
        const color = device.color(i, 0) || [0, 0, 0];

        colors.push(
            color[0] & 0xFF,
            color[1] & 0xFF,
            color[2] & 0xFF,
            0xFF
        );
    }

    const key = colors.join(",");

    if (key === previousColors) return;

    const maxPerReport = 14;

    for (let offset = 0; offset < count; offset += maxPerReport) {
        const ledCount = Math.min(maxPerReport, count - offset);
        const data = colors.slice(offset * 4, (offset + ledCount) * 4);
        const packet = buildPacket(COMMAND_LED, offset, data, REPORT_LENGTH);

        try {
            device.write(packet, REPORT_LENGTH);
        } catch (error) {
            log("LED write failed: " + error);
            return;
        }
    }

    previousColors = key;
}

export function Shutdown() {
    previousColors = null;
    activeProfile = null;
    deviceInfo = null;
}
