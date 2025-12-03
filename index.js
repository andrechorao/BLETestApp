/**
 * @format
 */

import { AppRegistry } from 'react-native';
import App from './App';
import { name as appName } from './app.json';

// ✅ Buffer polyfill for React Native
import { Buffer } from 'buffer';
global.Buffer = global.Buffer || Buffer;

AppRegistry.registerComponent(appName, () => App);
