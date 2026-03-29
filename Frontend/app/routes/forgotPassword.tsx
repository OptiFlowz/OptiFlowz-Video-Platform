import type { Route } from "./+types/account";
import ForgotPasswordPage from "~/components/forgotPasswordPage/forgotPasswordPage";

export function meta({}: Route.MetaArgs) {
  return [
    { title: "OptiFlowz Video Platform - Forgot Password" },
    { name: "description", content: "OptiFlowz video platform template for professional video libraries" },
  ];
}

function ForgotPassword(){  
    return <>
        <ForgotPasswordPage />
    </>;
}

export default ForgotPassword;
