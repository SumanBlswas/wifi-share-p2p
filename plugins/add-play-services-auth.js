const { withAppBuildGradle } = require("@expo/config-plugins");

module.exports = (config) => {
  return withAppBuildGradle(config, (config) => {
    if (config.modResults.language === "groovy") {
      const contents = config.modResults.contents;
      const dependency =
        "    implementation 'com.google.android.gms:play-services-auth:20.7.0'";

      if (!contents.includes("com.google.android.gms:play-services-auth")) {
        // Find the dependencies block and insert at the start
        config.modResults.contents = contents.replace(
          /dependencies\s?{/,
          `dependencies {\n${dependency}`,
        );
      }
    }
    return config;
  });
};
