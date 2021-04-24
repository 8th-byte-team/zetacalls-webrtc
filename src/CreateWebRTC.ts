export default async function CreateWebRTC(
    server:     string,
    username:   string,
    credential: string,
):Promise<RTCPeerConnection> {
    const pc = new RTCPeerConnection({
        iceServers: [
            {
                urls: `stun:${server}`,
            },
            {
                urls: [`turn:${server}`],
                username:   username,
                credential: credential,
            },
        ],
        iceTransportPolicy: "all",
    });

    return pc;
}
