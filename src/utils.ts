declare var __webrtc_logs:Map<string, string[]>

export function logout(user_guid: string, print:boolean, ...args:any[]) {
    if (print) console.log(...args)

    if (!__webrtc_logs) {
        __webrtc_logs = new Map();
    }

    __webrtc_logs.set(
        user_guid,
        [
            ...(__webrtc_logs.get(user_guid) || []),
            `${args.map(a => typeof a === "string" ? a : JSON.stringify(a)).join("")}`
        ]
    )
}