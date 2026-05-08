import "./index.css";
import { Composition } from "remotion";
import { LibrettoShort } from "./Composition";

export const RemotionRoot: React.FC = () => {
  return (
    <Composition
      id="LibrettoShort"
      component={LibrettoShort}
      durationInFrames={300}
      fps={30}
      width={3840}
      height={2160}
    />
  );
};
