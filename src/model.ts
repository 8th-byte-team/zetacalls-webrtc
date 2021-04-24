export type EncryptedMessage = {
    message:        string
}

export enum StreamType {
    Audio = 1,
    Video,
    Screen,
}

export const StreamNames:Partial<Record<StreamType, PermissionName>> = {
    1: "microphone",
    2: "camera",
}

export type StreamData = {
    id:      string,
    enabled: boolean,
}

export type Streams = Record<StreamType, MediaStream | null>

export type User = {
    guid:           string,
    streams:        Streams,
    is_online:      boolean,
    is_left:        boolean,
    name:           string,
    color:          string
}

export type StreamMap = Record<number, StreamData | undefined>;

export type SelectedDevices = {
    audio_in:  MediaDeviceInfo | undefined,
    audio_out: MediaDeviceInfo | undefined,
    video_in:  MediaDeviceInfo | undefined,
}

export type Transmitting = {
    SendOffer:           (user_guid: string, payload: EncryptedMessage) => void,
    SendICE:             (user_guid: string, payload: EncryptedMessage) => void,
    listenOffers:        (func: (data: EncryptedMessage) => void) => void,
    unlistenOffers:      (func: (data: EncryptedMessage) => void) => void,
    listenICEs:          (func: (data: EncryptedMessage) => void) => void,
    unlistenICEs:        (func: (data: EncryptedMessage) => void) => void,
}

export type DescriptionPayload = {
    user_guid:   string,
    description: string,
    conn_guid:   string,
    stream_map:   StreamMap
}

export type AnswerPayload = {
    skip:       boolean,
    answer:     string,
    stream_map:  StreamMap
}

export type ICEPayload = {
    user_guid:  string,
    candidate:  string,
    conn_guid:  string
}

export type Message<T extends string, P extends object> = {
    user_guid: string
    type:      T
    payload:   P
}

export type Credentials = { username: string, password: string }
export type WarningMessage = { title: string, body: string }