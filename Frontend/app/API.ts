type Props = {
    route: string,
    options: RequestInit
}

class FetchError extends Error {
  status: number;
  body?: any;
  constructor(status: number, message: string, body?: any) {
    super(message);
    this.status = status;
    this.body = body;
  }
}

export async function fetchFn<T>(props: Props): Promise<T> {
  const res = await fetch(`${import.meta.env.VITE_FIRST}/${props.route}`, props.options);

  if (res.status === 401) {
    if(window.location.pathname !== "/login"){
      localStorage.clear();
      sessionStorage.clear();
      window.location.href = "/login";
    }
    const data = await res.json();
    throw new FetchError(401, data.message);
  }

  const body = await res.json().catch(() => null);

  if (!res.ok) {
    throw new FetchError(res.status, body?.message ?? `HTTP error: ${res.status}`, body);
  }

  return body as T;
}
