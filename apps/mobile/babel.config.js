// Expo SDK 57 no requiere configuracion Babel propia salvo por el plugin de
// react-native-worklets, que react-native-reanimated (dependencia de la
// navegacion de expo-router) exige y que debe ser SIEMPRE el ultimo plugin.
module.exports = function babelConfig(api) {
  api.cache(true);

  return {
    presets: ['babel-preset-expo'],
    plugins: ['react-native-worklets/plugin']
  };
};
