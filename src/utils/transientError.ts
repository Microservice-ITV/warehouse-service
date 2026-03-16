export const isTransientError = (error: unknown): boolean => {
  if (!error || typeof error !== 'object') return false;
  const code = (error as { code?: string }).code;
  return (
    code === 'P1001' || // database unreachable
    code === 'P1002' || // connection timeout
    code === 'P1003' || // database does not exist
    code === 'P1008' || // operation timeout
    code === 'P1017' || // server closed connection
    code === 'ETIMEDOUT' ||
    code === 'ECONNRESET' ||
    code === 'ECONNREFUSED'
  );
};
