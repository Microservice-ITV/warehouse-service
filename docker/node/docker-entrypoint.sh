#!/bin/sh
set -e

cd /var/www/html/warehouse-service

echo "🚀 Starting Warehouse Service..."

echo "🔍 Checking DATABASE_URL..."

if [ -z "$DATABASE_URL" ]; then
  echo "❌ DATABASE_URL is missing!"
  exit 1
fi

echo "⏳ Waiting for database..."

if [ "${RUN_MIGRATIONS:-false}" = "true" ]; then
    echo "📦 Running Prisma migrations..."

    DATABASE_URL="$DATABASE_URL" \
    npx prisma migrate deploy --schema=./prisma/schema.prisma
fi

echo "✅ Starting application..."

exec "$@"
