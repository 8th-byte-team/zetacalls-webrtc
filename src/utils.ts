export function logout(user_guid: string, print:boolean, ...args:any[]) {
    if (print) console.log(...args)

    if (!globalThis.__webrtc_logs) {
        globalThis.__webrtc_logs = new Map();
    }

    globalThis.__webrtc_logs.set(
        user_guid,
        [
            ...(globalThis.__webrtc_logs.get(user_guid) || []),
            `${args.map(a => typeof a === "string" ? a : JSON.stringify(a)).join("")}`
        ]
    )
}