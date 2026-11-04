// What one recording ("take") of the live demo produced: the clips heard (AIRA's own audio, the user's voice) with
// word times, and the moments logged on screen. Times are seconds from the start of the recording.
export interface Word {
  text: string
  start: number
  end: number
}
export interface Clip {
  who: 'aira' | 'user' | 'narrator'
  file: string
  at: number
  duration: number
  words: Word[]
}
export interface TakeEvent {
  name: string
  at: number
}
export interface Take {
  duration: number
  clips: Clip[]
  events: TakeEvent[]
}
