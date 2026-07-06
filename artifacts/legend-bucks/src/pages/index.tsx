import { useEffect } from "react";
import { useLocation } from "wouter";

export default function App() {
  const [location, setLocation] = useLocation();

  useEffect(() => {
    if (location === "/") {
      setLocation("/dashboard");
    }
  }, [location, setLocation]);

  return null;
}
