import { Composition } from 'remotion'
import { AiraDemo } from './AiraDemo'
import { FPS, HEIGHT, TOTAL_FRAMES, WIDTH } from './constants'

export const Root: React.FC = () => (
  <Composition id="AiraDemo" component={AiraDemo} durationInFrames={TOTAL_FRAMES} fps={FPS} width={WIDTH} height={HEIGHT} />
)
