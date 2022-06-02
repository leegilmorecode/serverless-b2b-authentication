import axios, { AxiosRequestConfig, AxiosResponse } from "axios";

import { stringify } from "querystring";

export async function generateAccessToken(
  clientId: string,
  clientSecret: string,
  url: string,
  scopes: string[] = []
): Promise<string> {
  try {
    const payload = {
      grant_type: "client_credentials",
      scope: scopes.length ? scopes.join(" ") : undefined,
    };

    const options: AxiosRequestConfig = {
      method: "post",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      auth: {
        username: clientId,
        password: clientSecret,
      },
      data: stringify(payload),
      url: "/oauth2/token",
      baseURL: url,
    };

    const { data }: AxiosResponse<any> = await axios.request(options);
    return data?.access_token as string;
  } catch (error) {
    throw error;
  }
}
