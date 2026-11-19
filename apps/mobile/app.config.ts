import type { ExpoConfig } from "expo/config";

import pkg from "./package.json";

const BG = "#07070B";
const CAMERA =
  "Vexcast Remote usa la cámara para escanear el código QR de tu PC y para usar el móvil como cámara en tus directos. / Vexcast Remote uses the camera to scan your PC's QR code and to use the phone as a camera on your streams.";
const MIC =
  "Vexcast Remote usa el micrófono solo si decides enviarlo junto a la cámara del móvil. / Vexcast Remote uses the microphone only if you choose to send it along with the phone camera.";

const config: ExpoConfig = {
  name: "Vexcast Remote",
  slug: "vexcast-remote",
  scheme: "vexcast",
  version: pkg.version,
  // Portrait everywhere (locked at startup); the phone-camera screen turns while live.
  orientation: "default",
  icon: "./assets/icon.png",
  userInterfaceStyle: "dark",
  backgroundColor: BG,
  primaryColor: "#8B5CF6",
  description: "Control your Vexcast live-streaming studio from your phone over the local network.",
  githubUrl: "https://github.com/vexcast/vexcast",
  ios: {
    bundleIdentifier: "app.vexcast.remote",
    supportsTablet: true,
    infoPlist: {
      NSCameraUsageDescription: CAMERA,
      NSMicrophoneUsageDescription: MIC,
      NSLocalNetworkUsageDescription:
        "Vexcast Remote se conecta a Vexcast en tu PC a través de la red local. / Vexcast Remote connects to Vexcast on your PC over the local network.",
      NSAppTransportSecurity: {
        NSAllowsLocalNetworking: true,
      },
      ITSAppUsesNonExemptEncryption: false,
    },
  },
  android: {
    package: "app.vexcast.remote",
    adaptiveIcon: {
      foregroundImage: "./assets/adaptive-icon.png",
      monochromeImage: "./assets/adaptive-icon-monochrome.png",
      backgroundColor: BG,
    },
    permissions: ["android.permission.CAMERA", "android.permission.INTERNET", "android.permission.RECORD_AUDIO", "android.permission.MODIFY_AUDIO_SETTINGS"],
    predictiveBackGestureEnabled: false,
  },
  web: {
    bundler: "metro",
    output: "single",
    favicon: "./assets/favicon.png",
  },
  plugins: [
    "expo-router",
    "expo-localization",
    "expo-secure-store",
    "expo-web-browser",
    ["expo-screen-orientation", { initialOrientation: "PORTRAIT_UP" }],
    [
      "expo-camera",
      {
        cameraPermission: CAMERA,
        microphonePermission: MIC,
        recordAudioAndroid: true,
        barcodeScannerEnabled: true,
      },
    ],
    [
      "expo-splash-screen",
      {
        image: "./assets/splash-icon.png",
        imageWidth: 180,
        resizeMode: "contain",
        backgroundColor: BG,
      },
    ],
    [
      "expo-build-properties",
      {
        android: {
          // The desktop core speaks plain HTTP on the LAN.
          usesCleartextTraffic: true,
        },
      },
    ],
  ],
  experiments: {
    typedRoutes: false,
  },
  extra: {
    githubRepo: "vexcast/vexcast",
    kofiUrl: "https://ko-fi.com/emanueldev",
  },
};

export default config;
