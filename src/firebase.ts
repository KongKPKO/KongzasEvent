import { initializeApp } from "firebase/app";
// import { getFirestore } from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyDH_WUvvJ7tH6Wc18oMraSNOUTEIQw8sec",
  authDomain: "event-queue-app.firebaseapp.com",
  projectId: "event-queue-app",
  storageBucket: "event-queue-app.firebasestorage.app",
  messagingSenderId: "991644955784",
  appId: "1:991644955784:web:b5b28539ebb99cd4b49b3d",
  measurementId: "G-7G3Q0BNTCQ"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);

// Initialize Firestore (Database)
// Using experimentalForceLongPolling to avoid "Offline" issues in some network environments
import { initializeFirestore } from "firebase/firestore";
import { getAuth } from "firebase/auth";

export const db = initializeFirestore(app, {
  experimentalForceLongPolling: true,
});

export const auth = getAuth(app);
