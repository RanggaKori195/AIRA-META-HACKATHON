import { Composition } from 'remotion'
import { AiraTutorial, TUTORIAL_FRAMES } from './TutorialVideo'
import { FPS, HEIGHT, WIDTH } from './constants'

// The 3:00 tutorial. (The 2:00 demo was rendered from an earlier take: out/AIRA-demo-2min.mp4.)
export const Root: React.FC = () => (
  <Composition id="AiraTutorial" component={AiraTutorial} durationInFrames={TUTORIAL_FRAMES} fps={FPS} width={WIDTH} height={HEIGHT} />
)
