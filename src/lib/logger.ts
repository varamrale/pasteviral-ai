import winston from 'winston'

const redactSecrets = winston.format((info) => {
  const str = JSON.stringify(info)
  const redacted = str.replace(/"[^"]*":\s*"[^"]*(?:key|token|secret|password|bearer)[^"]*"/gi, '"[REDACTED]"')
  return JSON.parse(redacted)
})()

export const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    redactSecrets,
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [new winston.transports.Console()],
})