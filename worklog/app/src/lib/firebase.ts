import AsyncStorage from "@react-native-async-storage/async-storage";
import { REGION } from "@worklog/shared";
import { getApp, getApps, initializeApp, type FirebaseApp } from "firebase/app";
import {
  connectAuthEmulator,
  getReactNativePersistence,
  initializeAuth,
  type Auth,
} from "firebase/auth";
import { connectFirestoreEmulator, getFirestore, type Firestore } from "firebase/firestore";
import { connectFunctionsEmulator, getFunctions, type Functions } from "firebase/functions";

import { emulatorHost, firebaseConfig, useEmulator } from "./config";

/**
 * Firebase の初期化。
 * Functions は asia-northeast1 に固定する (F-510)。既定の us-central1 を使うと呼び出せない。
 */

let cachedApp: FirebaseApp | undefined;
let cachedAuth: Auth | undefined;
let cachedDb: Firestore | undefined;
let cachedFunctions: Functions | undefined;

export function firebaseApp(): FirebaseApp {
  if (!cachedApp) {
    cachedApp = getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);
  }
  return cachedApp;
}

export function firebaseAuth(): Auth {
  if (!cachedAuth) {
    // AsyncStorage を渡さないとメモリ永続化になり、再起動ごとにログインし直しになる
    cachedAuth = initializeAuth(firebaseApp(), {
      persistence: getReactNativePersistence(AsyncStorage),
    });
    if (useEmulator) {
      connectAuthEmulator(cachedAuth, `http://${emulatorHost}:9099`, { disableWarnings: true });
    }
  }
  return cachedAuth;
}

export function firestore(): Firestore {
  if (!cachedDb) {
    cachedDb = getFirestore(firebaseApp());
    if (useEmulator) connectFirestoreEmulator(cachedDb, emulatorHost, 8080);
  }
  return cachedDb;
}

export function functions(): Functions {
  if (!cachedFunctions) {
    cachedFunctions = getFunctions(firebaseApp(), REGION);
    if (useEmulator) connectFunctionsEmulator(cachedFunctions, emulatorHost, 5001);
  }
  return cachedFunctions;
}
