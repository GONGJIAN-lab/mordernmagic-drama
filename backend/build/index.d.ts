declare global {
    namespace Express {
        interface Response {
            data: (payload: any) => Response;
        }
    }
}
export {};
//# sourceMappingURL=index.d.ts.map