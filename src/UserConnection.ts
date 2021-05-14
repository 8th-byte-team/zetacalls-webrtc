import CreateWebRTC from './CreateWebRTC';
import { Messages, transmitMessage } from './Messages';
import { StreamType, Credentials, DescriptionPayload, ICEPayload, StreamMap } from './model';
import { logout } from './utils';

let useLogs = false;

export class UserConnection {
    private Credentials:       Credentials;
    private RoomGUID:          string
    private OnStatusChange:    (status: "connected" | "disconnected") => void;
    private SendOffer:         (user_guid: string, data: DescriptionPayload) => void;
    private SendICE:           (user_guid: string, data: ICEPayload) => void;
    private OnGetMediaStream:  (type: StreamType, track: MediaStream | null) => void;
    private OnToggleUserAudio: (user_guid: string, status: boolean) => void;
    private OnOpenDataChannel: (user_guid: string) => void;
    private GUID:              string = "";
    public RTC:                RTCPeerConnection | null = null;
    private DataChannel:       RTCDataChannel | null = null;
    private SenderStreamMap:   StreamMap = {};
    private ReceiverStreamMap: StreamMap = {};
    private TrackSenders:      Record<number, RTCRtpSender> = {};
    public Making =            false;
    public AnsweringPending =  false;
    public IgnoreOffer =       false;
    public IsPolite =          true;
    private CurrentUserGUID:  string;
    private OtherUserGUID:    string;
    private Server:           string;
    private GenerateID:       () => string;

    constructor(props: {
        current_user_guid:    string
        other_user_guid:      string
        credentials:          Credentials
        room_guid:            string
        server:               string
        send_offer:           (user_guid: string, data: DescriptionPayload) => void,
        send_ice:             (user_guid: string, data: ICEPayload) => void,
        on_status_change:     (status: "connected" | "disconnected") => void,
        on_get_media_stream:  (type: StreamType, track: MediaStream | null) => void,
        on_toggle_user_audio: (user_guid: string, status: boolean) => void,
        on_open_data_channel: (user_guid: string) => void,
        generate_id:          () => string;
    }) {
        this.RoomGUID          = props.room_guid;
        this.CurrentUserGUID   = props.current_user_guid;
        this.OtherUserGUID     = props.other_user_guid;
        this.Credentials       = props.credentials;
        this.SendOffer         = props.send_offer;
        this.SendICE           = props.send_ice;
        this.OnStatusChange    = props.on_status_change;
        this.OnGetMediaStream  = props.on_get_media_stream;
        this.OnToggleUserAudio = props.on_toggle_user_audio;
        this.OnOpenDataChannel = props.on_open_data_channel;
        this.Server            = props.server;
        this.GenerateID        = props.generate_id;
    }

    public BeginConnetion(streams:Record<StreamType, MediaStream | null>) {
        this.StartRTC(streams);
    }

    public async SetOffer(data: DescriptionPayload, streams:Record<StreamType, MediaStream | null>) {
        return this.StartRTCWithOfffer(data, streams);
    }

    public SetICE = (data: ICEPayload) => {
        if (this.RTC) {
            //logout(useLogs, "Got ICE from user: ", data.user_guid, ". GUID: ", data.conn_guid);
            this.RTC.addIceCandidate(
                new RTCIceCandidate(JSON.parse(data.candidate))
            )
        }
    }

    public SetStream = (type: StreamType, stream: MediaStream | null) => {
        if (this.RTC) {
            if (stream) {
                this.SenderStreamMap[type] = {id: stream.id, enabled: !!stream.getTracks()[0].enabled};

                this.TrackSenders[type] = this.RTC.addTrack(stream.getTracks()[0], stream);
                if (type === StreamType.Video && this.TrackSenders[StreamType.Screen]) {
                    delete this.SenderStreamMap[StreamType.Screen];
                    this.RTC.removeTrack(this.TrackSenders[StreamType.Screen]);
                } else if (type === StreamType.Screen && this.TrackSenders[StreamType.Video]) {
                    delete this.SenderStreamMap[StreamType.Video];
                    this.RTC.removeTrack(this.TrackSenders[StreamType.Video]);
                }
            } else if (this.TrackSenders[type]) {
                delete this.SenderStreamMap[type];
                this.RTC.removeTrack(this.TrackSenders[type]);
            }
        }
    }

    public SendMessage = (msg: Messages) => {
        if (this.DataChannel && this.DataChannel.readyState === "open") {
            this.DataChannel.send(JSON.stringify(msg));
        }
    }

    public Close = () => {
        this.RTC && this.RTC.close();
        this.RTC = null;
        this.DataChannel = null;
    }

    public CheckConnection = (streams:Record<StreamType, MediaStream | null>) => {
        if (
            this.RTC && (
                this.RTC.connectionState === "closed" || 
                this.RTC.connectionState === "disconnected" ||
                this.RTC.connectionState === "failed"
            )
        ) {
            this.BeginConnetion(streams);
        }
    }

    private async InitRTC(guid?: string) {
        this.GUID = guid || this.GenerateID();
        logout(this.OtherUserGUID, useLogs, "Created conn GUID: ", this.GUID);
    
        this.RTC = await CreateWebRTC(this.Server, this.Credentials.username, this.Credentials.password);
        this.RTC.addEventListener("icecandidate",               this.OnRTCICECandidate);
        this.RTC.addEventListener("icecandidateerror",          this.OnRTCICECandidateError);
        this.RTC.addEventListener("iceconnectionstatechange",   this.OnRTCICEConnectionStateChange);
        this.RTC.addEventListener("connectionstatechange",      this.OnRTCConnectionStateChange)
        this.RTC.addEventListener("negotiationneeded",          this.OnRTCNegotiationNeeded);
        this.RTC.addEventListener("track",                      this.OnRTCTrack);
        this.RTC.addEventListener("datachannel",                this.OnRTCDataChannel);
    }

    private StartRTC = async (streams:Record<StreamType, MediaStream | null>) => {
        this.IsPolite = false
        await this.InitRTC();

        if (this.RTC) {
            let stream_map:StreamMap = {};
            Object.entries(streams).forEach(([type, stream]) => {
                if (stream) {
                    stream.getTracks().forEach(track => this.RTC?.addTrack(track, stream))
                    stream_map[parseInt(type)] = {id: stream.id, enabled: !!stream.getTracks()[0].enabled};
                }
            });
            logout(this.OtherUserGUID, useLogs, "Start RTC: ", stream_map);
            this.SenderStreamMap = stream_map;
            this.DataChannel = this.RTC.createDataChannel("main");
            this.DataChannel.addEventListener("close",   this.OnRTCDataChannelClose);
            this.DataChannel.addEventListener("open",    this.OnRTCDataChannelOpen);
            this.DataChannel.addEventListener("message", this.OnRTCDataChannelMessage);
        }
    }

    private PerformNegotiation = async () => {
        if (this.RTC) {
            if (this.RTC.signalingState === "stable" && !this.Making) {
                this.Making = true;
                const offer = await this.RTC.createOffer({
                    offerToReceiveAudio: true,
                    offerToReceiveVideo: true,
                });
    
                await this.RTC.setLocalDescription(offer);

                //@ts-ignore
                if (this.RTC.signalingState === "have-local-offer" && this.RTC.localDescription?.type === "offer") {
                    logout(this.OtherUserGUID, useLogs, "Sent offer to user. Conn GUID: ", this.GUID);
                    this.SendOffer(this.OtherUserGUID, {
                        conn_guid:   this.GUID,
                        user_guid:   this.CurrentUserGUID,
                        description: JSON.stringify(this.RTC.localDescription),
                        stream_map:  this.SenderStreamMap,
                    });
                }
            }
        }

        this.Making = false;
    }

    private StartRTCWithOfffer = async (data: DescriptionPayload, streams:Record<StreamType, MediaStream | null>) => {
        logout(this.OtherUserGUID, useLogs, "Got offer from user. Conn GUID: ", data.conn_guid);
        if (!this.RTC) {
            await this.InitRTC(data.conn_guid);

            let stream_map:StreamMap = {};
            Object.entries(streams).forEach(([type, stream]) => {
                if (stream) {
                    stream.getTracks().forEach(track => this.RTC?.addTrack(track, stream))
                    stream_map[parseInt(type)] = {id: stream.id, enabled: !!stream.getTracks()[0].enabled};
                }
            });
            logout(this.OtherUserGUID, useLogs, "Start RTC: ", stream_map);
            this.SenderStreamMap = stream_map;
        }

        if (this.RTC) {
            const description = new RTCSessionDescription(JSON.parse(data.description))
            const isStable =
                this.RTC.signalingState === 'stable' ||
                (this.RTC.signalingState === 'have-local-offer' && this.AnsweringPending);
            
            this.IgnoreOffer = description.type === 'offer' && !this.IsPolite && (this.Making || !isStable);

            if (this.IgnoreOffer) {
                logout(this.OtherUserGUID, useLogs, "Glare - ignoring offer. Conn GUID: ", data.conn_guid);
                return;
            }

            this.AnsweringPending = description.type === 'answer';
            logout(this.OtherUserGUID, useLogs, `Set Remote Description (${description.type}). Conn GUID: `, data.conn_guid);

            this.ReceiverStreamMap = data.stream_map;
            await this.RTC.setRemoteDescription(description);

            this.AnsweringPending = false;

            if (description.type === 'offer') {
                if (this.RTC.signalingState === "have-remote-offer" && this.RTC.remoteDescription?.type === "offer") {
                    logout(this.OtherUserGUID, useLogs, "Set LocaL Description to get back to stable. Conn GUID: ", data.conn_guid);
                    const answer = await this.RTC.createAnswer({
                        offerToReceiveAudio: true,
                        offerToReceiveVideo: true,
                    });
    
                    await this.RTC.setLocalDescription(answer);
                    
                    //@ts-ignore
                    if (this.RTC.signalingState === "stable" && this.RTC.localDescription?.type === "answer") {
                        logout(this.OtherUserGUID, useLogs, "Sent offer to user. Conn GUID: ", data.conn_guid);
                        this.SendOffer(this.OtherUserGUID, {
                            conn_guid:   this.GUID,
                            user_guid:   this.CurrentUserGUID,
                            description: JSON.stringify(this.RTC.localDescription),
                            stream_map:   this.SenderStreamMap,
                        });
                    }
                }
            } else if (this.RTC.remoteDescription?.type === "answer" && this.RTC.signalingState === "stable") {
                this.RTC.dispatchEvent(new Event('negotiated'));
            }
        }
    }
    
    private OnRTCICECandidate = async (event: RTCPeerConnectionIceEvent) => {
        if (event.candidate) {
            //("Send ICE to user: ", this.OtherUserGUID, ". GUID: ", this.GUID);
            this.SendICE(this.OtherUserGUID, {
                conn_guid:  this.GUID,
                user_guid:  this.CurrentUserGUID,
                candidate:  JSON.stringify(event.candidate),
            });
        }
    }

    private OnRTCTrack = (event: RTCTrackEvent) => {
        const eventStream = event.streams[0];
        logout(this.OtherUserGUID, useLogs, "Got track from user. Conn GUID: ", this.GUID, " ID: ", eventStream?.id);
        const data = Object.entries(this.ReceiverStreamMap).find(
            ([ type, streamData ]) => streamData?.id === eventStream?.id
        );
 
        if (data) {
            const ReceiverStreamType = parseInt(data[0]);
            const StreamData = data[1];

            eventStream.addEventListener("removetrack", () => {
                this.OnGetMediaStream(ReceiverStreamType, null);
            });

            if (ReceiverStreamType === StreamType.Audio) {
                logout(this.OtherUserGUID, useLogs, "OnRTCTrack Audio stream data:", StreamData)
                eventStream.getTracks().forEach(t => t.enabled = !!StreamData?.enabled);
            }

            this.OnGetMediaStream(ReceiverStreamType, eventStream);
        }
    }

    private OnRTCNegotiationNeeded = async () => {
        logout(this.OtherUserGUID, useLogs, "Negotiation needed for user. Conn GUID: ", this.GUID);
        try {
            await this.PerformNegotiation();   
        } catch (error) {
            console.log(error);
        }
    }
    
    private OnRTCICEConnectionStateChange = () => {
        if (this.RTC) {
            logout(this.OtherUserGUID, useLogs, "Status changed to ", this.RTC.iceConnectionState, ". Conn GUID: ", this.GUID);

            if (this.RTC.iceConnectionState === "disconnected") {
                logout(this.OtherUserGUID, useLogs, "Closed ICE connection with user. Conn GUID: ", this.GUID);
            } else if (this.RTC.iceConnectionState === "connected") {
                logout(this.OtherUserGUID, useLogs, "Connected with user. Conn GUID: ", this.GUID);
                this.OnStatusChange("connected");
            }
        }
    }

    private OnRTCConnectionStateChange = () => {
        if (this.RTC) {
            if (this.RTC.connectionState === "disconnected") {
                this.OnStatusChange("disconnected");
            }
        }
    }

    private OnRTCICECandidateError = (event: RTCPeerConnectionIceErrorEvent) => {
        logout(this.OtherUserGUID, useLogs, "Got ICE error on connection with user. Conn GUID: ", this.GUID, "Error code: ", event.errorCode, " Error text: ", event.errorText);
    }

    private OnRTCDataChannel = async (event: RTCDataChannelEvent) => {
        logout(this.OtherUserGUID, useLogs, "Got data channel from user. Conn GUID: ", this.GUID);
        event.channel.addEventListener("close", this.OnRTCDataChannelClose);
        event.channel.addEventListener("open", this.OnRTCDataChannelOpen);
        event.channel.addEventListener("message", this.OnRTCDataChannelMessage);
        this.DataChannel = event.channel;
    }

    private OnRTCDataChannelOpen = () => {
        logout(this.OtherUserGUID, useLogs, "OnRTCDataChannelOpen")
        this.OnOpenDataChannel(this.OtherUserGUID)
    }
    
    private OnRTCDataChannelClose = () => {
        logout(this.OtherUserGUID, useLogs, "Closed data channel with user. Conn GUID: ", this.GUID);
        this.OnStatusChange("disconnected");
    }

    private OnRTCDataChannelMessage = (event: MessageEvent) => {
        if (event.isTrusted && event.data) {
            try {
                const msg:Messages = JSON.parse(event.data); 
                if (msg.type === "toggle-audio") {
                    this.OnToggleUserAudio(msg.user_guid, msg.payload.status);
                } else {
                    transmitMessage(this.RoomGUID, msg);
                }
            } catch (error) {
                console.log("can't parse message: ", error);
            }
        }
    }
}