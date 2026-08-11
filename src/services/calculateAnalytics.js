export async function calculateAnalytics(
    query,
    executePagedQuery,
    pageSize = 5000
) {

    let pagingState = null;
    let totalRecords = 0;

    const overall = {};
    const hourly = {};
    const daily = {};
    const monthly = {};

    do {

        const result = await executePagedQuery(
            query,
            pageSize,
            pagingState
        );

        const rows = result.rows;

        totalRecords += rows.length;

        // Aggregation logic will come here

        pagingState = result.pagingState;

    } while (pagingState);

    return {
        overallAverage: overall,
        hourlyAverage: hourly,
        dailyAverage: daily,
        monthlyAverage: monthly,
        totalRecords
    };
}