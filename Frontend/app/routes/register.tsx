import RegisterPage from "~/components/registerPage/registerPage";
import type { Route } from "./+types/login";

export function meta({}: Route.MetaArgs) {
  return [
    { title: "OptiFlowz Video Platform Register" },
    { name: "description", content: "OptiFlowz video platform template for professional video libraries" },
  ];
}

function Register(){
  return <>
      <RegisterPage />
  </>;
}

export default Register;