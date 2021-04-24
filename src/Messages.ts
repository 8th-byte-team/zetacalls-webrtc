import { EventEmitter } from 'eventemitter3';
import { Message } from './model';

export type BaseMessagePayload = {
    guid:       string,
    user_name:  string,
    created_on: number,
}

export type Messages = 
    Message<"chat", BaseMessagePayload & {text: string}> |
    Message<"emoji", BaseMessagePayload & { emoji_marker: string }> |
    Message<"meta", BaseMessagePayload & { text: string }> |
    Message<"name-changed", BaseMessagePayload & { name: string }> |
    Message<"toggle-audio", BaseMessagePayload & { stream_id: string, status: boolean }>

type InternalCallback<P extends Messages> = (type: P["type"], payload: P["payload"], to_users?: string[], ) => void;
type MessagesCallback = (msg: Messages) => void;

const InternalEvents = new EventEmitter<string, Messages>();
const MessagesEvents = new EventEmitter<string, Messages>();

export function SendMessage<P extends Messages>(room_guid: string, type: P["type"], payload: P["payload"], to_users?: string[], ) {
    InternalEvents.emit(room_guid, type, payload, to_users);
}

export function bindOnInternal<P extends Messages>(room_guid: string, func: InternalCallback<P>) {
    InternalEvents.addListener(room_guid, func)
}

export function unbindOnInternal<P extends Messages>(room_guid: string, func: InternalCallback<P>) {
    InternalEvents.removeListener(room_guid, func)
}

export function transmitMessage(room_guid: string, msg: Messages) {
    MessagesEvents.emit(room_guid, msg)
}

export function bindOnMessages(room_guid: string, func: MessagesCallback) {
    MessagesEvents.addListener(room_guid, func)
}

export function unbindOnMessages(room_guid: string, func: MessagesCallback) {
    MessagesEvents.removeListener(room_guid, func)
}