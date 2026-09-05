import { useState } from "react";
import DefaultProfile from "../../../assets/DefaultProfile.webp";

export default function PlatformUserAvatar({ imageUrl }: { imageUrl?: string | null }) {
  const source = imageUrl?.trim() || DefaultProfile;
  const [failedSource, setFailedSource] = useState<string | null>(null);

  return (
    <img
      className="platformUserAvatar"
      src={failedSource === source ? DefaultProfile : source}
      alt=""
      loading="lazy"
      decoding="async"
      onError={() => setFailedSource(source)}
    />
  );
}
