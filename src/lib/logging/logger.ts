import { LoggingService, LogLevel } from "./index";

export const logger = new LoggingService("tRPC Explorer", "INFO");

export function setLogLevel(level: LogLevel) {
  logger.setOutputLevel(level);
}
