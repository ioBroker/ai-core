"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __exportStar = (this && this.__exportStar) || function(m, exports) {
    for (var p in m) if (p !== "default" && !Object.prototype.hasOwnProperty.call(exports, p)) __createBinding(exports, m, p);
};
Object.defineProperty(exports, "__esModule", { value: true });
/**
 * `@iobroker/ai-core` - the AI backend shared by admin, javascript and vis-2.
 *
 * - `shared/*`: types, sendTo protocol, tool loop, helpers - also usable in the browser via
 *   `@iobroker/ai-core/build/shared`
 * - `node/*`: talking to the providers, the settings of an adapter, the credential store and the
 *   sendTo handler `AiBackend`
 */
__exportStar(require("./shared"), exports);
__exportStar(require("./node/http"), exports);
__exportStar(require("./node/providers"), exports);
__exportStar(require("./node/settings"), exports);
__exportStar(require("./node/credentials"), exports);
__exportStar(require("./node/AiBackend"), exports);
//# sourceMappingURL=index.js.map