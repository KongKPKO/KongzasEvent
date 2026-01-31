
const ProductSkeleton = () => {
    // Render 6 skeleton items to fill the screen
    return (
        <div className="pt-[115px] px-3 grid grid-cols-2 gap-2 pb-44 overflow-y-auto">
            {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="bg-white rounded-xl shadow-sm overflow-hidden flex flex-col h-full border border-gray-100">
                    {/* Image Placeholder */}
                    <div className="aspect-square bg-gray-100 relative w-full overflow-hidden animate-pulse">
                        <div className="absolute inset-0 bg-gray-200" />
                    </div>
                    {/* Content Placeholder */}
                    <div className="p-2.5 flex flex-col flex-1 justify-between">
                        <div className="mb-2 space-y-1.5">
                            <div className="h-3 bg-gray-200 rounded w-11/12 animate-pulse" />
                            <div className="h-2.5 bg-gray-100 rounded w-2/3 animate-pulse" />
                        </div>
                        <div className="flex flex-col gap-1.5 mt-2">
                            <div className="h-3.5 bg-gray-200 rounded w-1/3 animate-pulse" />
                            <div className="h-7 bg-gray-900/10 rounded-md w-full animate-pulse" />
                        </div>
                    </div>
                </div>
            ))}
        </div>
    );
};

export default ProductSkeleton;
