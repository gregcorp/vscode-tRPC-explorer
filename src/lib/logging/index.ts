// Taken from https://github.com/prettier/prettier-vscode/blob/d10657266d2dd01c556a3cc9a75d288962ae340e/src/LoggingService.ts
// This code is licensed under the MIT license:
// MIT License
// Copyright (c) 2017 Esben Petersen

// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:

// The above copyright notice and this permission notice shall be included in all
// copies or substantial portions of the Software.

// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.

import { window } from "vscode";

export type LogLevel = "DEBUG" | "INFO" | "WARN" | "ERROR" | "NONE";

export class LoggingService {
  private outputChannel = window.createOutputChannel("tRPC Explorer");

  private logLevel: LogLevel = "INFO";

  constructor(channelName?: string, initialLevel: LogLevel = "INFO") {
    if (channelName) {
      this.outputChannel = window.createOutputChannel(channelName);
    }
    this.logLevel = initialLevel;
  }

  public setOutputLevel(logLevel: LogLevel) {
    this.logLevel = logLevel;
  }

  /**
   * Append messages to the output channel and format it with a title
   *
   * @param message The message to append to the output channel
   */
  public logDebug(message: string, data?: unknown): void {
    if (
      this.logLevel === "NONE" ||
      this.logLevel === "INFO" ||
      this.logLevel === "WARN" ||
      this.logLevel === "ERROR"
    ) {
      return;
    }
    this.logMessage(message, "DEBUG");
    if (data) {
      this.logObject(data);
    }
  }

  /**
   * Append messages to the output channel and format it with a title
   *
   * @param message The message to append to the output channel
   */
  public logInfo(message: string, data?: unknown): void {
    if (
      this.logLevel === "NONE" ||
      this.logLevel === "WARN" ||
      this.logLevel === "ERROR"
    ) {
      return;
    }
    this.logMessage(message, "INFO");
    if (data) {
      this.logObject(data);
    }
  }

  /**
   * Append messages to the output channel and format it with a title
   *
   * @param message The message to append to the output channel
   */
  public logWarning(message: string, data?: unknown): void {
    if (this.logLevel === "NONE" || this.logLevel === "ERROR") {
      return;
    }
    this.logMessage(message, "WARN");
    if (data) {
      this.logObject(data);
    }
  }

  public logError(message: string, error?: unknown) {
    if (this.logLevel === "NONE") {
      return;
    }
    this.logMessage(message, "ERROR");
    if (typeof error === "string") {
      // Errors as a string usually only happen with
      // plugins that don't return the expected error.
      this.outputChannel.appendLine(error);
    } else if (error instanceof Error) {
      if (error?.message) {
        this.logMessage(error.message, "ERROR");
      }
      if (error?.stack) {
        this.outputChannel.appendLine(error.stack);
      }
    } else if (error) {
      this.logObject(error);
    }
  }

  public show() {
    this.outputChannel.show();
  }

  private logObject(data: unknown): void {
    // const message = JSON.parser
    //   .format(JSON.stringify(data, null, 2), {
    //     parser: "json",
    //   })
    //   .trim();
    const message = JSON.stringify(data, null, 2); // dont use prettier to keep it simple

    this.outputChannel.appendLine(message);
  }

  /**
   * Append messages to the output channel and format it with a title
   *
   * @param message The message to append to the output channel
   */
  private logMessage(message: string, logLevel: LogLevel): void {
    const title = new Date().toLocaleTimeString();
    this.outputChannel.appendLine(`["${logLevel}" - ${title}] ${message}`);
  }
}
