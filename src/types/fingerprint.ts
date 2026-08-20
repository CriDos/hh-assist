export interface FingerprintHashes {
  strict_hash: string;
  soft_hash: string;
  hardware_hash: string;
}

export interface FingerprintProfile {
  id: string;
  label: string;
  auto?: boolean;
  visitorId: string;
  xhh: string;
  hashes: FingerprintHashes;
}

export interface SyntheticComponents {
  canvas: {
    value: {
      geometry: string;
      text: string;
    };
  };
  webGlBasics: {
    value: {
      rendererUnmasked: string;
      vendorUnmasked: string;
    };
  };
  webGlExtensions: {
    value: {
      extensions: string[];
    };
  };
  plugins: {
    value: unknown[];
  };
  fonts: {
    value: string[];
  };
  fontPreferences: {
    value: Record<string, unknown>;
  };
  screenResolution: {
    value: [number, number];
  };
  colorDepth: {
    value: number;
  };
  deviceMemory: {
    value: number;
  };
  hardwareConcurrency: {
    value: number;
  };
  math: {
    value: Record<string, unknown>;
  };
  audio: {
    value: Record<string, unknown>;
  };
}
