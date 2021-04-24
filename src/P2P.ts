import { OrderedMap } from "immutable";
import moment from "moment";
import ImmuUpdate from 'immutability-helper';
// local
import { Messages, bindOnInternal, unbindOnInternal } from "./Messages";
import { UserConnection } from "./UserConnection";
import { AudioOut } from './AudioOut';
import { Decrypt, Encrypt } from "./crypto";
import { 
    StreamType,
    User,
    Credentials,
    SelectedDevices,
    Transmitting,
    DescriptionPayload,
    ICEPayload,
    StreamNames,
    EncryptedMessage,
    WarningMessage,
} from './model';

declare global {
    interface MediaDevices {
        getDisplayMedia(constraints?: MediaStreamConstraints): Promise<MediaStream>;
    }
  
    interface MediaTrackConstraintSet {
        displaySurface?: ConstrainDOMString;
        logicalSurface?: ConstrainBoolean;
    }
}

let use_logs = false;
const logout = (...args: any) => use_logs && console.log(...args);

type Props = {
    current_user: User,
    transmitting: Transmitting,
    credentials:  Credentials,
    is_ios:       boolean,
    server:       string,
    on_warning:   (data: WarningMessage) => void,
    generate_id:  () => string,
}

export class P2P {
    private RoomGUID:        string;
    private Credentials:     Credentials;
    private Transmitting:    Transmitting;
    private EncryptionKey:   string;
    private OnChange:        () => void;
    private CurrentUserGUID: string;
    private AudioStream:     MediaStream | null = null;
    private Connections:     OrderedMap<string, UserConnection> = OrderedMap<string, UserConnection>();
    private AudioOut:        AudioOut | null = null;
    private IsIOS:           boolean;
    private Server:          string;
    private OnWarning:       (data: WarningMessage) => void;
    private GenerateID:      () => string;

    public started              = false;
    public Users                = OrderedMap<string, User>()
    public SelectedDevices:     SelectedDevices = {
        audio_in:  undefined,
        audio_out: undefined,
        video_in:  undefined,
    };

    constructor(props: Props) {
        this.OnChange            = () => {
            console.error("On change for ZetaP2P is not defined")
        }
        this.RoomGUID        = "";
        this.EncryptionKey   = "";
        this.IsIOS           = props.is_ios;
        this.Server          = props.server;
        this.OnWarning       = props.on_warning;
        this.GenerateID      = props.generate_id;
        this.Credentials     = props.credentials;
        this.Transmitting    = props.transmitting;
        this.CurrentUserGUID = props.current_user.guid;
        this.Users           = OrderedMap<string, User>().set(props.current_user.guid, props.current_user);
    }

    get CurrentUser() {
        const user = this.Users.get(this.CurrentUserGUID);
        if (!user) {
            throw new Error("No current user");
        }

        return user;
    }

    public toggle_camera_mode = async () => {
        const CurrentUser = this.CurrentUser;
        const type = StreamType.Video;
        let curFM:string | undefined; //currentFacingMode

        if (CurrentUser.streams[type]) {
            curFM = CurrentUser.streams[type]?.getVideoTracks()[0].getSettings().facingMode

            try {
                const stream = await navigator.mediaDevices.getUserMedia({
                    video: {
                        facingMode: { 
                            exact: !curFM || curFM === "user" ? "environment" : "user"
                        }
                    }
                })
    
                CurrentUser.streams[type]?.getTracks().forEach(track => {
                    CurrentUser.streams[type]?.removeTrack(track);
                    track.stop();
                });
                CurrentUser.streams[type] = stream;
    
                this.Connections.forEach(conn => conn.SetStream(type, stream));
                this.Users = this.Users.set(CurrentUser.guid, CurrentUser);
                this.OnChange();
            } catch(e) {}
        }
    }

    public toggle_stream = async (type: StreamType) => {
        if (!this.started) {
            console.error("WebRTC is not started");
            return;
        }

        if (type === StreamType.Audio) {
            this.toggle_audio();
            return;
        }

        const CurrentUser = this.CurrentUser;
        let stream:MediaStream | null = null;

        const StreamName = StreamNames[type];

        if (CurrentUser.streams[type]) {
            logout(`Found active stream ${StreamName}. Stopping`);
            CurrentUser.streams[type]?.getTracks().forEach(track => {
                CurrentUser.streams[type]?.removeTrack(track);
                track.stop();
            });

            CurrentUser.streams[type] = null;
        } else {
            logout(`Stream ${StreamName} not found. Getting new stream`)
            try {
                if (type === StreamType.Video) {
                    stream = await navigator.mediaDevices.getUserMedia({
                        video: this.SelectedDevices.video_in ? {
                            deviceId: this.SelectedDevices.video_in.deviceId,
                        } : true
                    });

                    if (CurrentUser.streams[StreamType.Screen]) {
                        CurrentUser.streams[StreamType.Screen]?.getTracks().forEach(track => {
                            CurrentUser.streams[StreamType.Screen]?.removeTrack(track);
                            track.stop();
                        });

                        CurrentUser.streams[StreamType.Screen] = null;
                    }
                } else if (type === StreamType.Screen) {
                    stream = await navigator.mediaDevices.getDisplayMedia({
                        video: true,
                    });

                    // handle browser button "Stop sharing"
                    stream.getVideoTracks()[0].onended = () => {
                        this.StopUserStream(StreamType.Screen)
                    };

                    if (CurrentUser.streams[StreamType.Video]) {
                        CurrentUser.streams[StreamType.Video]?.getTracks().forEach(track => {
                            CurrentUser.streams[StreamType.Video]?.removeTrack(track);
                            track.stop();
                        });

                        CurrentUser.streams[StreamType.Video] = null;
                    }
                }
            } catch (error) {
                logout("Stream error: ", error);
                this.OnWarning({
                    title: `Failed to get available devices`,
                    body:  `Media device error`,
                });
            }

            CurrentUser.streams[type] = stream;
        }

        this.Connections.forEach(conn => conn.SetStream(type, stream));
        this.Users = this.Users.set(CurrentUser.guid, CurrentUser);
        this.OnChange();
    }

    private toggle_audio = async () => {
        if (!this.started) {
            console.error("WebRTC is not started");
            return;
        }

        if (this.AudioStream) {
            let status = false;
            if (this.AudioStream.getAudioTracks().find(t => !t.enabled)) {
                this.AudioStream.getAudioTracks().forEach(track => {
                    track.enabled = true;
                });
                status = true;
            } else {
                this.AudioStream.getAudioTracks().forEach(track => {
                    track.enabled = false;
                });
                status = false;
            }

            this.EmitNewAudioStreamStatus(status);
        } else {
            if (this.CurrentUser.streams[StreamType.Audio]) {
                this.CurrentUser.streams[StreamType.Audio]?.getTracks().forEach(track => {
                    this.CurrentUser.streams[StreamType.Audio]?.removeTrack(track);
                    track.stop();
                });
                this.Connections.forEach(conn => conn.SetStream(StreamType.Audio, null));
                this.Users = this.Users.set(this.CurrentUser.guid, ImmuUpdate(
                    this.CurrentUser,
                    {"streams": {[StreamType.Audio]: {"$set": null}}}
                ));
            } else {
                try {
                    this.UpdateAudioStreamWithDeviceID(this.SelectedDevices.audio_in?.deviceId || "", true)
                } catch (error) {
                    this.OnWarning({
                        title: `Failed to get available devices`,
                        body:  `Media device error`,
                    });
                }
            }
        }

        this.OnChange();
    }

    public select_devices = async (audio_in?: MediaDeviceInfo, audio_out?: MediaDeviceInfo, video_in?: MediaDeviceInfo) => {
        if (this.started) {
            try {
                const CurrentUser = this.CurrentUser;
                if (
                    CurrentUser.streams[StreamType.Audio] &&
                    (
                        this.SelectedDevices.audio_in?.deviceId !== audio_in?.deviceId ||
                        this.SelectedDevices.audio_in?.groupId !== audio_in?.groupId    
                    )
                ) {
                    await this.ChangeUserStream(StreamType.Audio, audio_in?.deviceId)
                }

                if (
                    CurrentUser.streams[StreamType.Video] && 
                    (
                        this.SelectedDevices.video_in?.deviceId !== video_in?.deviceId ||
                        this.SelectedDevices.video_in?.groupId !== video_in?.groupId    
                    )
                ) {
                    await this.ChangeUserStream(StreamType.Video, video_in?.deviceId)
                }

                this.SelectedDevices.audio_in = audio_in;
                this.SelectedDevices.audio_out = audio_out;
                this.SelectedDevices.video_in = video_in;

                if (audio_out) {
                    this.AudioOut?.SetOutputDevice(audio_out.deviceId);
                }

                this.OnChange();    
            } catch (error) {
                console.log("Stream error: ", error)
                this.OnWarning({
                    title: `Failed to get available devices`,
                    body:  `Media device error`,
                });
            }
        } else {
            console.error("WebRTC is not started");
        }
    }

    public AddUser = async (other_user: User) => {
        if (this.started) {
            if (!this.Users.has(other_user.guid)) {
                this.Users = this.Users.set(other_user.guid, other_user);
                this.Connections = this.Connections.set(other_user.guid, new UserConnection({
                    current_user_guid:    this.CurrentUser.guid,
                    other_user_guid:      other_user.guid,
                    credentials:          this.Credentials,
                    room_guid:            this.RoomGUID,
                    server:               this.Server,
                    send_offer:           this.SendOffer,
                    send_ice:             this.SendICE,
                    on_status_change:     this.OnStatusChange(other_user.guid),
                    on_get_media_stream:  this.OnGetMediaStream(other_user.guid),
                    on_toggle_user_audio: this.OnToggleUserAudio,
                    on_open_data_channel: this.OnOpenDataChannel,
                    generate_id:          this.GenerateID,
                }))
            
                this.OnChange();
            }
        } else {
            console.error("WebRTC is not started");
        }
    }

    public SetCurrentUserName = (name: string) => {
        this.Users = this.Users.set(this.CurrentUserGUID, ImmuUpdate(this.CurrentUser, { name: {"$set": name} }));
    }

    public UpdateUserName = (user_guid:string, name: string) => {
        let User = this.Users.get(user_guid);
        if (User) {
            User.name = name;
            this.Users = this.Users.set(User.guid, User);
            this.OnChange();
        }
    }

    public InitConnection = (user_guid: string) => {
        logout("Init user: ", user_guid, " Current: ", this.CurrentUser.guid)
        const conn = this.Connections.get(user_guid);
        if (conn) {
            conn.BeginConnetion(this.CurrentUser.streams);
        }
    }

    public StartWebRTC(
        room_guid:      string,
        encryption_key: string,
        stream:         MediaStream | null,
        creds:          Credentials,
        on_change:      () => void
    ) {
        if (!this.started) {
            this.AudioStream   = stream;
            this.RoomGUID      = room_guid;
            this.EncryptionKey = encryption_key;
            this.OnChange      = on_change;
            this.started       = true;
            this.Credentials   = creds;
            this.AudioOut      = new AudioOut({ selector: `room-${room_guid}`, is_ios: this.IsIOS });
            
            if (this.AudioStream) {
                this.AudioStream.getAudioTracks().forEach(track => {
                    track.enabled = false;
                });

                this.Users = this.Users.set(this.CurrentUserGUID, ImmuUpdate(
                    this.CurrentUser,
                    {"streams": { [StreamType.Audio]: { "$set": this.AudioStream } }}
                ));
            }

            this.StartListeners();
        }
    }

    public StopWebRTC() {
        this.RoomGUID      = "";
        this.EncryptionKey = "";
        this.OnChange      = () => {};
        this.started       = false;
        this.Credentials   = { username: "", password: "" };

        this.StopListeners();

        this.Connections.forEach(conn => { conn.Close() });

        this.CurrentUser.streams[StreamType.Audio]?.getTracks().forEach(track => { track.stop(); });
        this.CurrentUser.streams[StreamType.Video]?.getTracks().forEach(track => { track.stop(); });
        this.CurrentUser.streams[StreamType.Screen]?.getTracks().forEach(track => { track.stop(); });
        this.AudioStream?.getTracks().forEach(track => { track.stop(); });

        this.CurrentUser.streams[StreamType.Audio] = null;
        this.CurrentUser.streams[StreamType.Video] = null;
        this.CurrentUser.streams[StreamType.Screen] = null;
        this.AudioStream = null;
        this.AudioOut?.Destructor();
        this.AudioOut = null;

        this.Users = this.Users.set(this.CurrentUser.guid, this.CurrentUser);
    }

    public GlobalMute() {
        this.AudioOut?.Mute();
    }

    public GlobalUnmute() {
        this.AudioOut?.UnMute();
    }

    private OnStatusChange = (user_guid:string) => (status: "connected" | "disconnected") => {
        let user = this.Users.get(user_guid);
        if (user) {
            user = ImmuUpdate(user, { is_left: { "$set": status === "disconnected" }});
            user = ImmuUpdate(user, { is_online: { "$set": status === "connected" }});
            if (status === "disconnected") {
            } else if (status === "connected" && this.AudioStream) {
            }
            this.Users = this.Users.set(user_guid, user);
            this.OnChange();
        }
    }
    
    private OnGetMediaStream = (user_guid: string) => (type: StreamType, stream: MediaStream | null) => {
        let user = this.Users.get(user_guid);
        if (user) {
            user = ImmuUpdate(user, { streams: { [type]: { "$set":  stream }}});
            this.Users = this.Users.set(user_guid, user);
            if (type === StreamType.Audio) {
                if (stream) {
                    this.AudioOut?.AddStream(user_guid, stream);
                } else {
                    console.log("OnGetMediaStream userGuid:", user_guid);
                    this.AudioOut?.RemoveStream(user_guid);
                }
            }
            this.OnChange();
        } 
    }

    private OnToggleUserAudio = (user_guid: string, status: boolean) => {
        let user = this.Users.get(user_guid);
        if (user) {
            if (user.streams[StreamType.Audio]) {
                user.streams[StreamType.Audio]?.getTracks().forEach(t => t.enabled = status);
                this.AudioOut?.ToggleStream(user_guid, status);
                this.OnChange();
            }
        }
    }

    private OnOpenDataChannel = (user_guid: string) => {
        const UserConn = this.Connections.get(user_guid)
        if (this.AudioStream && UserConn) {
            const status = Boolean(this.AudioStream.getAudioTracks().find(t => t.enabled));
            this.SendNewAudioStreamStatus(UserConn, status);
        }
    }

    private StartListeners() {
        this.Transmitting.listenOffers(this.OnOffer);
        this.Transmitting.listenICEs(this.OnICE);
        bindOnInternal(this.RoomGUID, this.OnUserSentMessage);
    }

    private StopListeners() {
        this.Transmitting.unlistenOffers(this.OnOffer);
        this.Transmitting.unlistenICEs(this.OnICE);
        unbindOnInternal(this.RoomGUID, this.OnUserSentMessage);
    }

    private OnUserSentMessage = <M extends Messages>(type: M["type"], payload: M["payload"], to_users?: string[]) => {
        this.Connections.forEach((conn, user_guid) => {
            if (!to_users || to_users.findIndex(guid => guid === user_guid) >= 0) {
                //@ts-ignore
                const msg:Messages = {
                    user_guid:    this.CurrentUser.guid,
                    type,
                    payload,
                };

                conn.SendMessage(msg);
            }
        });
    }

    private SendOffer = (user_guid: string, data: DescriptionPayload):void => {
        this.Transmitting.SendOffer(user_guid, { message: Encrypt(this.EncryptionKey, "p2p-offer", data)});
    }

    private SendICE = async (user_guid: string, data: ICEPayload) => {
        this.Transmitting.SendICE(user_guid, { message: Encrypt(this.EncryptionKey, "p2p-on-ice", data)});
    }

    private OnOffer = async (msg: EncryptedMessage, reply?: (msg: EncryptedMessage) => void) => {
        const [ data ] = Decrypt(this.EncryptionKey, "p2p-offer", msg.message);
        if (!data) {
            logout("Decryption error: key = "+this.EncryptionKey);
            return;
        }

        const userConn = this.Connections.get(data.user_guid);
        if (userConn) {
            userConn.SetOffer(data, this.CurrentUser.streams);
        }
    }

    private OnICE = (msg: EncryptedMessage) => {
        const [ data ] = Decrypt(this.EncryptionKey, "p2p-on-ice", msg.message);
        if (!data) {
            logout("Decryption error: key = "+this.EncryptionKey);
            return;
        }

        const userConn = this.Connections.get(data.user_guid);
        if (userConn) {
            userConn.SetICE(data);
        }
    }

    private UpdateAudioStreamWithDeviceID = async (deviceID: string, enabled:boolean) => {
        this.AudioStream = await navigator.mediaDevices.getUserMedia({
            audio: deviceID ? {
                deviceId: deviceID,
            } : true
        });

        this.AudioStream.getAudioTracks().forEach(t => t.enabled = enabled);
        
        this.Connections.forEach(conn => conn.SetStream(StreamType.Audio, this.AudioStream));
        this.Users = this.Users.set(this.CurrentUser.guid, ImmuUpdate(
            this.CurrentUser,
            {"streams": {[StreamType.Audio]: {"$set": this.AudioStream}}}
        ));
    }

    private EmitNewAudioStreamStatus = (status:boolean) => {
        this.Connections.forEach(conn => { this.SendNewAudioStreamStatus(conn, status) });
    }

    private SendNewAudioStreamStatus = (conn: UserConnection, status:boolean) => {
        conn.SendMessage({
            user_guid: this.CurrentUserGUID,
            type:      "toggle-audio",
            payload:   {
                guid:       this.GenerateID(),
                user_name:  this.CurrentUser.name,
                created_on: moment().unix(),
                stream_id:  this.AudioStream?.id || "",
                status:     status,
            }
        });
    }

    private ChangeUserStream = async (type: StreamType.Audio | StreamType.Video, deviceID?:string) => {
        const CurrentUser = this.CurrentUser;
        let enabled = false;
        
        // get new stream
        let mediaName = type === StreamType.Audio ? "audio" : "video"

        const stream = await navigator.mediaDevices.getUserMedia({
            [mediaName]: deviceID ? {
                deviceId: deviceID,
            } : true
        });
        
        // if AudioStream is working 
        if (type === StreamType.Audio && this.AudioStream) {
            this.AudioStream.getAudioTracks().forEach(track => {
                enabled = enabled || track.enabled;
                track.stop();
            });

            await this.UpdateAudioStreamWithDeviceID(deviceID || "", enabled);
            this.EmitNewAudioStreamStatus(enabled);
        } else {
            CurrentUser.streams[type]?.getTracks().forEach(track => {
                enabled = enabled || track.enabled;
                CurrentUser.streams[type]?.removeTrack(track);
                track.stop();
            });
            
            
            stream.getTracks().forEach(track => track.enabled = enabled)
            CurrentUser.streams[type] = stream;
            
            this.Users = this.Users.set(CurrentUser.guid, CurrentUser);
            this.Connections.forEach(conn => conn.SetStream(StreamType.Audio, stream));    
        }
    }

    private StopUserStream = (type: StreamType) => {
        const CurrentUser = this.CurrentUser;
        CurrentUser.streams[type]?.getTracks().forEach(track => {
            CurrentUser.streams[type]?.removeTrack(track);
            track.stop();
        });

        CurrentUser.streams[type] = null;

        this.Connections.forEach(conn => conn.SetStream(type, null));
        this.Users = this.Users.set(CurrentUser.guid, CurrentUser);
        this.OnChange();
    }
}
