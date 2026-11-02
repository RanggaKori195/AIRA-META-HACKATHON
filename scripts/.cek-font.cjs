const { app } = require('electron')
const { existsSync } = require('fs')
const { join } = require('path')
app.whenReady().then(() => {
  console.log('getAppPath   =', app.getAppPath())
  console.log('resourcesPath=', process.resourcesPath)
  for (const d of [
    join(app.getAppPath(), 'resources', 'fonts'),
    join(process.resourcesPath ?? '', 'fonts'),
    join(app.getAppPath(), 'src', 'renderer', 'src', 'assets', 'fonts')
  ]) console.log(existsSync(join(d,'CompanySerif-Regular.woff2')) ? 'ADA   ' : 'kosong', d)
  app.exit(0)
})
