import * as runtypes from 'runtypes';
import { AES, enc } from "crypto-js";

const StreamDataRuntime = runtypes.Record({
    id:      runtypes.String,
    enabled: runtypes.Boolean,
}).Or(runtypes.Undefined)

const StreamMap = runtypes.Dictionary(StreamDataRuntime)

const ConnectionICERuntime = runtypes.Record({ 
    user_guid: runtypes.String,
    candidate: runtypes.String,
    conn_guid: runtypes.String,
});

type ConnectionICE = runtypes.Static<typeof ConnectionICERuntime>;

const ConnectionOfferRuntime = runtypes.Record({ 
    user_guid:   runtypes.String,
    description: runtypes.String,
    conn_guid:   runtypes.String,
    stream_map:  StreamMap,
});

type ConnectionOffer = runtypes.Static<typeof ConnectionOfferRuntime>;

const MessagesRuntype = {
    "p2p-on-ice":                    ConnectionICERuntime,
    "p2p-offer":                     ConnectionOfferRuntime,
}

export type EncryptedMessages = {
    "p2p-on-ice":                    ConnectionICE
    "p2p-offer":                     ConnectionOffer
}

export type EncryptedMessage = {
    message:        string
}

export const Encrypt = <K extends keyof EncryptedMessages>(encryption_key: string, marker: K, message: EncryptedMessages[K]):string => {
    return AES.encrypt(JSON.stringify({ marker, message }), encryption_key).toString();
}

export const Decrypt = <K extends keyof EncryptedMessages>(encryption_key: string, marker: K, message: string):[EncryptedMessages[K], null] |  [null, string] => {
    const bytes = AES.decrypt(message, encryption_key);
    const res = JSON.parse(bytes.toString(enc.Utf8));
    
    if (res && res.marker === marker && res.message) {
        if (res.message !== null) {
            const status = MessagesRuntype[marker].validate(res.message);
            if (!status.success) {
                return [ null, "runtime validation error" ];
            } else {
                return [ res.message, null ]
            }
        }
    }

    return [ null, "Bad data" ];
}
    