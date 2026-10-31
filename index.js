import { registerRootComponent } from "expo";
// Daily installs Android background timers. Initialize them before app/auth
// imports can create timers that would later be cleared by a different registry.
import "@daily-co/react-native-daily-js";
import App from "./App";
registerRootComponent(App);
