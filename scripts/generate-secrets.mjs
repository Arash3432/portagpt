import { randomBytes } from "node:crypto";

const secret = (bytes = 48) => randomBytes(bytes).toString("base64");

console.log(`SESSION_PEPPER=${secret()}`);
console.log(`OTP_PEPPER=${secret()}`);
console.log(`CONFIG_ENCRYPTION_KEY=${randomBytes(32).toString("base64")}`);
console.log("\nاین سه مقدار را فقط در متغیرهای محرمانه لیارا ثبت کنید و در چت یا Git نفرستید.");
