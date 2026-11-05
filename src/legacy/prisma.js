const { PrismaClient } = require('@prisma/client');

function getPrisma() {
  if (!global.__prismaInstance) {
    let dbUrl = process.env.DATABASE_URL;
    const options = {
      log: ['warn', 'error'],
    };
    if (dbUrl && dbUrl.includes('pooler.supabase.com') && !dbUrl.includes('pgbouncer=true')) {
      const separator = dbUrl.includes('?') ? '&' : '?';
      dbUrl = `${dbUrl}${separator}pgbouncer=true`;
      options.datasources = { db: { url: dbUrl } };
    }
    global.__prismaInstance = new PrismaClient(options);
  }
  return global.__prismaInstance;
}

module.exports = new Proxy({}, {
  get(target, prop) {
    const instance = getPrisma();
    const value = instance[prop];
    if (typeof value === 'function') {
      return value.bind(instance);
    }
    return value;
  }
});
