// 2:00 — narrator card, the real recorded demo, narrator card; captions from the voices on top.
import { AbsoluteFill, Sequence } from 'remotion'
import { introFrames, outroFrames, timeline } from './data2'
import { Demo } from './Demo'
import { IntroCard, OutroCard } from './Cards'
import { Captions2 } from './Captions2'
import { Background } from './ui'
import { TOTAL_FRAMES } from './constants'

export const AiraDemo: React.FC = () => (
  <AbsoluteFill style={{ backgroundColor: '#eef3fb' }}>
    <Background />
    <Sequence from={0} durationInFrames={introFrames} name="intro">
      <IntroCard />
    </Sequence>
    <Sequence from={timeline.demoFrom} durationInFrames={timeline.demoFrames} name="demo">
      <Demo />
    </Sequence>
    <Sequence from={TOTAL_FRAMES - outroFrames} durationInFrames={outroFrames} name="outro">
      <OutroCard />
    </Sequence>
    <Captions2 />
  </AbsoluteFill>
)
