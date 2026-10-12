import { SessionManager } from '../../src/core/session-manager.ts'

process.env.PI_SESSION_FORMAT = 'html.gz'
const directory = process.argv[2]
const manager = SessionManager.create(directory, directory)
for (let index = 0; index < 40; index += 1) {
  manager.appendMessage({ role: 'user', content: `repeated words for compression ${index}`, timestamp: Date.now() })
}
process.stdout.write(manager.getSessionFile())
