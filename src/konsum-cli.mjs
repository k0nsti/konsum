import program from "commander";
import { resolve, join } from "path";
import { expand } from "config-expander";
import { prepareDatabase } from "./database";
import { prepareHttpServer } from "./http";
import { version, description } from "../package.json";

program
  .description(description)
  .version(version)
  .option("-c, --config <directory>", "use config from directory")
  .action(async args => {
    const configDir = process.env.CONFIGURATION_DIRECTORY || program.config;

    // some constants used while loading the configuration
    const constants = {
      basedir: configDir || process.cwd(), // where is the config file located
      installdir: resolve(__dirname, ".."), // make references to the installdir possible
      statedir: process.env.STATE_DIRECTORY || process.cwd()
    };

    // default config if none is given
    const defaultConfig = {
      database: {
        path: "db"
      },
      http: {
        port: 123456
      }
    };

    // load config and expand expressions ${something} inside
    const config = await expand(
      configDir ? "${include('config.json')}" : defaultConfig,
      {
        constants
      }
    );

    if (process.env.PORT !== undefined) {
      port = parseInt(process.env.PORT, 10);
      if (Number.isNaN(port)) {
        port = process.env.PORT;
      }

      config.http.port = port;
    }

/*
    console.log(JSON.stringify(process.env,undefined,2));
    console.log(JSON.stringify(config,undefined,2));
*/
    // prepare the database with the config
    const db = await prepareDatabase(config);

    // prepare the web-server with the config and the database
    const http = await prepareHttpServer(config, db);
  })
  .parse(process.argv);
