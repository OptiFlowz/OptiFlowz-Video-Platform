import LoginPage from "~/components/loginPage/loginPage";
import type { Route } from "./+types/login";

export function meta({}: Route.MetaArgs) {
  return [
    { title: "OptiFlowz Video Platform Login" },
    { name: "description", content: "OptiFlowz video platform template for professional video libraries" },
  ];
}

function Login(){
  return <>
      <LoginPage />
  </>;
}

export default Login;