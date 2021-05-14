import { OrderedMap } from "immutable";
import { logout } from "./utils";

let useLogs = false;

export class AudioOut {
    private AudioRootElement: HTMLAudioElement | null = null;
    private Selector:         string;
    private IsIOS:            boolean;

    private Streams:OrderedMap<string, MediaStream> = OrderedMap();

    constructor({ selector, is_ios }:{ selector: string, is_ios: boolean}) {
        this.Selector = selector;
        this.IsIOS = is_ios;

        const el = document.getElementById(this.Selector) as (HTMLAudioElement | null);
        if (el) {
            this.AudioRootElement = el;
            this.StartListeners();
        } else {
            throw new Error("Can't find audio element");
        }
    }

    get RootElement() {
        if (this.AudioRootElement) {
            return this.AudioRootElement;
        } else {
            throw new Error("Can't find audio element");
        }
    }

    public Destructor() {
        this.StopListeners();
        this.Streams.forEach((stream, guid) => {
            const output = document.getElementById(`audio-out-${guid}`) as HTMLAudioElement;
            if (output) {
                output.srcObject = null;
            }
        })
        this.AudioRootElement = null;
        this.Streams = OrderedMap();
    }

    public async AddStream(guid: string, stream: MediaStream) {
        logout(guid, useLogs, "Add user audio. Enabled: ", stream.getTracks()[0].enabled);
        let output = document.getElementById(`audio-out-${guid}`) as HTMLAudioElement;

        if (!output) {
            output = document.createElement('audio');
            output.id = `audio-out-${guid}`;
            output.setAttribute("placeinline", "true");
            output.setAttribute("autoplay", "true");
            
            this.RootElement.appendChild(output);
        }

        this.Streams = this.Streams.set(guid, stream);
        this.UpdateStreams();

        this.StartIOS(guid);
    }

    public RemoveStream(guid: string) {
        logout(guid, useLogs, "Remove user audio");
        this.Streams = this.Streams.remove(guid);
        const output = document.getElementById(`audio-out-${guid}`);
        output?.remove();
    }

    public ToggleStream(guid: string, status: boolean) {
        const stream = this.Streams.get(guid);
        logout(guid, useLogs, "Toggle user audio. Enabled: ", stream?.getTracks()[0].enabled);
        if (stream) {
            stream.getTracks().forEach(t => t.enabled = status);
            this.Streams = this.Streams.set(guid, stream);
            // only for ios we need to reasign srcObject for this case (<3 ios)
            if (this.IsIOS) {
                this.UpdateStreams();
            }
        }
    }

    public Mute() {
        this.Streams.forEach((stream, guid) => {
            const output = document.getElementById(`audio-out-${guid}`) as HTMLAudioElement;
            if (output && !output.paused) {
                output.pause();
            }
        })
    }

    public UnMute() {
        this.Streams.forEach((stream, guid) => {
            const output = document.getElementById(`audio-out-${guid}`) as HTMLAudioElement;
            if (output && output.paused) {
                output.play();
            }
        })
    }

    public SetOutputDevice(new_device_id: string) {
        if (new_device_id) {
            this.Streams.forEach((stream, guid) => {
                const output = document.getElementById(`audio-out-${guid}`) as HTMLAudioElement;
                // @ts-ignore
                if (output && output.setSinkId) {
                    try {
                        // @ts-ignore
                        output.setSinkId(new_device_id)   
                    } catch (error) {
                        console.log(error);
                    }
                }
            });
        }
    }

    private UpdateStreams() {
        this.Streams.forEach((stream, guid) => {
            const output = document.getElementById(`audio-out-${guid}`) as HTMLAudioElement;
            if (output && output.srcObject !== stream) {
                output.srcObject = stream;
            }
        });
    }

    private OnVisibilityChange = () => {
        if (this.IsIOS) {
            if (document.visibilityState === "visible") {
                this.UpdateStreams();
            }
        }
    }

    private StartListeners() {
        document.addEventListener("visibilitychange", this.OnVisibilityChange);
    }

    private StopListeners() {
        document.removeEventListener("visibilitychange", this.OnVisibilityChange)
    }

    private async StartIOS(guid: string) {
        if (this.IsIOS) {
            const output = document.getElementById(`audio-out-${guid}`) as HTMLAudioElement | null;
            if (output) {
                output.addEventListener("canplaythrough", () => {
                    console.log("can start for ", guid, " statuses: ", output.paused, output.muted, output.ended);
                })
                try {
                    await output.play();
                } catch (error) {
                    alert("error during starting audio stream");
                    console.log("FIRST TRY ERROR, NEED TO PLAY ", error);
                }
            }
        }
    }
}