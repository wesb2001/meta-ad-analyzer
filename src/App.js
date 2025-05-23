import React, { useState } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import Papa from 'papaparse';
import * as XLSX from 'xlsx';
import './App.css';

function App() {
  const [adData, setAdData] = useState([]);
  const [adNames, setAdNames] = useState([]);
  const [processedResults, setProcessedResults] = useState([]);
  const [closedAds, setClosedAds] = useState([]);
  const [lineVisibility, setLineVisibility] = useState({
    dailyRoas: true,
    cumulativeRoas: true,
    pocc: true,
    dailySpend: true,
    cumulativeSpend: true,
  });

  // 여러 파일 업로드 처리
  const handleFileUpload = (e) => {
    const files = Array.from(e.target.files);
    let allRows = [];
    let filesParsed = 0;

    files.forEach((file) => {
      Papa.parse(file, {
        header: true,
        dynamicTyping: true,
        encoding: 'utf-8',
        complete: (results) => {
          if (results.data && results.data.length > 0) {
            const validData = results.data.filter(
              (row) => row['광고 이름'] && row['지출 금액 (KRW)'] !== undefined
            );
            allRows = allRows.concat(validData);
          }
          filesParsed++;
          if (filesParsed === files.length) {
            // 모든 파일 파싱 완료 후 처리
            const uniqueAdNames = [...new Set(allRows.map((row) => row['광고 이름']))];
            // 내림차순 정렬
            uniqueAdNames.sort((a, b) => b.localeCompare(a));
            setAdNames(uniqueAdNames);
            setAdData(allRows);
            // 모든 광고별로 분석
            const results = uniqueAdNames.map((adName) => {
              const filteredData = allRows.filter((row) => row['광고 이름'] === adName);
              const processed = processAdData(filteredData);
              const optimal = findOptimalDay(processed);
              return { adName, processed, optimal };
            });
            setProcessedResults(results);
          }
        },
        error: (error) => {
          console.error('CSV 파싱 에러:', error);
          alert('CSV 파일 처리 중 오류가 발생했습니다.');
        },
      });
    });
  };

  // CSV 데이터 처리 및 POCC 계산
  const processAdData = (filteredData) => {
    const dailyMap = new Map();
    filteredData.forEach((row) => {
      if (!row['보고 시작']) return;
      const dateStr = row['보고 시작'];
      const day = dateStr.split('-')[2];
      const dayNum = parseInt(day, 10);
      if (!dailyMap.has(dayNum)) {
        dailyMap.set(dayNum, {
          date: dayNum.toString(),
          spend: 0,
          roas: 0,
          clicks: 0,
          conversions: 0,
        });
      }
      const dayData = dailyMap.get(dayNum);
      dayData.spend += row['지출 금액 (KRW)'] || 0;
      dayData.roas = row['구매 ROAS(광고 지출 대비 수익률)'] || 0;
      dayData.clicks += row['클릭(전체)'] || 0;
      dayData.conversions += row['구매'] || 0;
      dayData.budget = row['광고 세트 예산'] || 0;
    });
    let dailyData = Array.from(dailyMap.values());
    dailyData.sort((a, b) => parseInt(a.date) - parseInt(b.date));
    const totalRoas = filteredData.reduce((sum, row) => {
      return sum + (row['구매 ROAS(광고 지출 대비 수익률)'] || 0);
    }, 0);
    const averageRoas = totalRoas / filteredData.length || 1.77;
    let cumulativeData = [];
    let cumulativeSpend = 0;
    let cumulativeConversions = 0;
    let cumulativeRevenue = 0;
    for (const day of dailyData) {
      if (day.spend > 0) {
        cumulativeSpend += day.spend;
        cumulativeConversions += day.conversions;
        const dailyRevenue = day.spend * day.roas;
        cumulativeRevenue += dailyRevenue;
        cumulativeData.push({
          date: day.date,
          dailySpend: day.spend,
          dailyRoas: day.roas,
          dailyClicks: day.clicks,
          dailyConversions: day.conversions,
          cumulativeSpend,
          cumulativeConversions,
          cumulativeRevenue,
          cumulativeRoas: cumulativeRevenue / cumulativeSpend || 0,
          budget: day.budget
        });
      }
    }
    const poccData = cumulativeData.map((day, index) => {
      const poccValue = calculatePOCC(cumulativeData, index, averageRoas);
      return {
        ...day,
        pocc: poccValue.pocc,
        scaledSpend: day.dailySpend / 10000,
        scaledCumulativeSpend: day.cumulativeSpend / 10000,
      };
    });
    return poccData;
  };

  // POCC 계산 함수
  const calculatePOCC = (cumulativeData, index, averageRoas) => {
    const currentDay = cumulativeData[index];
    let futureRoas = 0;
    let futureDataCount = 0;
    for (let i = index + 1; i < cumulativeData.length; i++) {
      futureRoas += cumulativeData[i].dailyRoas;
      futureDataCount++;
    }
    futureRoas = futureDataCount > 0 ? futureRoas / futureDataCount : currentDay.dailyRoas;
    const rsi = currentDay.cumulativeRoas / averageRoas;
    const recentDays = [];
    for (let i = Math.max(0, index - 2); i <= index; i++) {
      recentDays.push(cumulativeData[i].dailyRoas);
    }
    const mean = recentDays.reduce((sum, val) => sum + val, 0) / recentDays.length;
    const variance = recentDays.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / recentDays.length;
    const stdDev = Math.sqrt(variance);
    const sdi = mean === 0 ? 0 : 1 - (stdDev / mean);
    const efi = futureRoas === 0 ? 1 : currentDay.cumulativeRoas / futureRoas;
    const dsi = Math.min(currentDay.cumulativeSpend / 50000, 1);
    const totalBudget = currentDay.budget;
    const remainingBudget = totalBudget - currentDay.cumulativeSpend;
    const rdi = remainingBudget > 0 && totalBudget > 0 ? 0.1 * (remainingBudget / totalBudget) : 0;
    const pocc = (rsi * sdi * efi * dsi) - rdi;
    return {
      date: currentDay.date,
      rsi,
      sdi,
      efi,
      dsi,
      rdi,
      pocc,
      cumulativeRoas: currentDay.cumulativeRoas,
      cumulativeSpend: currentDay.cumulativeSpend,
      dailyRoas: currentDay.dailyRoas,
      targetReached: currentDay.cumulativeRoas >= 2.5,
      sufficientData: currentDay.cumulativeSpend >= 50000,
      futureRoas,
      efficiencyDecreasing: currentDay.cumulativeRoas > futureRoas
    };
  };

  // 최적 중단 시점 찾기
  const findOptimalDay = (processedData) => {
    const eligibleDays = processedData.filter(day => 
      day.cumulativeRoas >= 2.5 && 
      day.cumulativeSpend >= 50000 && 
      day.cumulativeRoas > day.futureRoas
    );
    const positivePoccDays = eligibleDays.filter(day => day.pocc > 0);
    if (positivePoccDays.length > 0) {
      return positivePoccDays.reduce((max, day) => 
        day.pocc > max.pocc ? day : max, positivePoccDays[0]
      );
    } else if (eligibleDays.length > 0) {
      return eligibleDays.reduce((max, day) => 
        day.pocc > max.pocc ? day : max, eligibleDays[0]
      );
    }
    return null;
  };

  const handleCloseAd = (adName) => {
    setClosedAds((prev) => [...prev, adName]);
  };

  const handleLegendClick = (o) => {
    const { dataKey } = o;
    setLineVisibility((prev) => ({
      ...prev,
      [dataKey]: !prev[dataKey],
    }));
  };

  const handleDownloadExcel = (adName, processed) => {
    // 데이터 준비
    const data = processed.map(day => ({
      '날짜': `5월 ${day.date}일`,
      '일별 ROAS': day.dailyRoas?.toFixed(2),
      '누적 ROAS': day.cumulativeRoas?.toFixed(2),
      'POCC': day.pocc?.toFixed(2),
      '지출금액(원)': day.dailySpend?.toLocaleString(),
      '누적지출금액(원)': day.cumulativeSpend?.toLocaleString()
    }));

    // 워크북 생성
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(data);

    // 열 너비 설정
    const colWidths = [
      { wch: 10 }, // 날짜
      { wch: 12 }, // 일별 ROAS
      { wch: 12 }, // 누적 ROAS
      { wch: 12 }, // POCC
      { wch: 15 }, // 지출금액
      { wch: 15 }  // 누적지출금액
    ];
    ws['!cols'] = colWidths;

    // 워크시트를 워크북에 추가
    XLSX.utils.book_append_sheet(wb, ws, '광고성과');

    // 엑셀 파일 다운로드
    XLSX.writeFile(wb, `${adName}_광고성과.xlsx`);
  };

  return (
    <div className="App">
      <header className="App-header">
        <h1>광고 성과 분석 도구</h1>
      </header>
      <div className="container">
        <div className="upload-section">
          <h2>데이터 업로드</h2>
          <input
            type="file"
            accept=".csv"
            multiple
            onChange={handleFileUpload}
            className="file-input"
          />
        </div>
        {processedResults.length > 0 && processedResults
          .filter(({ adName, processed }) => {
            const basicCondition = processed && processed.length > 5 && !closedAds.includes(adName);
            // 원본 데이터에서 해당 광고의 마지막 날짜의 지출금액 확인
            const adRows = adData.filter(row => row['광고 이름'] === adName);
            if (adRows.length === 0) return false;
            // 날짜 기준으로 정렬
            adRows.sort((a, b) => new Date(a['보고 시작']) - new Date(b['보고 시작']));
            const lastRow = adRows[adRows.length - 1];
            const lastSpend = lastRow['지출 금액 (KRW)'] || 0;

            // 누적 ROAS, 누적지출금액 확인
            const lastProcessed = processed[processed.length - 1];
            const cumulativeRoas = lastProcessed?.cumulativeRoas || 0;
            const cumulativeSpend = lastProcessed?.cumulativeSpend || 0;

            // 누적 ROAS가 0이고, 누적지출금이 1만원 이하이면 제외
            const excludeLowSpendZeroRoas = cumulativeRoas === 0 && cumulativeSpend <= 10000;

            return basicCondition && lastSpend > 0 && !excludeLowSpendZeroRoas;
          })
          .sort((a, b) => {
            const aLastDay = a.processed[a.processed.length - 1];
            const bLastDay = b.processed[b.processed.length - 1];
            return bLastDay.cumulativeSpend - aLastDay.cumulativeSpend;
          })
          .map(({ adName, processed, optimal }) => (
            <div className="results-section" key={adName} style={{ position: 'relative' }}>
              <div style={{ position: 'absolute', top: 10, right: 10, display: 'flex', gap: '10px' }}>
                <button
                  onClick={() => handleDownloadExcel(adName, processed)}
                  style={{
                    background: '#4CAF50',
                    color: 'white',
                    border: 'none',
                    padding: '5px 10px',
                    borderRadius: '4px',
                    cursor: 'pointer',
                    fontSize: '0.9rem'
                  }}
                  title="엑셀 다운로드"
                >
                  📥 엑셀
                </button>
                <button
                  onClick={() => handleCloseAd(adName)}
                  style={{
                    background: 'transparent',
                    border: 'none',
                    fontSize: '1.5rem',
                    cursor: 'pointer',
                    color: '#888'
                  }}
                  aria-label="닫기"
                  title="닫기"
                >
                  ×
                </button>
              </div>
              <h2>광고 소재: {adName}</h2>
              <div className="chart-container">
                <h3>통합 성과 차트</h3>
                <div className="chart">
                  <ResponsiveContainer width="100%" height={400}>
                    <LineChart
                      data={processed}
                      margin={{ left: 90, right: 60, top: 5, bottom: 5 }}
                    >
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="date" />
                      <YAxis yAxisId="left" />
                      <YAxis yAxisId="right" orientation="right" />
                      <Tooltip 
                        formatter={(value, name) => {
                          // 소수점이 있는 지표들 (ROAS, POCC 등)
                          const decimalMetrics = ['일별 ROAS', '누적 ROAS', 'POCC'];
                          if (decimalMetrics.includes(name)) {
                            return [value.toFixed(2), name];
                          }
                          // 금액 관련 지표들
                          if (name.includes('지출금액')) {
                            return [value.toLocaleString(), name];
                          }
                          return [value, name];
                        }}
                      />
                      <Legend onClick={handleLegendClick} />
                      <Line yAxisId="left" type="monotone" dataKey="dailyRoas" stroke="#FF0000" name="일별 ROAS" hide={!lineVisibility.dailyRoas} />
                      <Line yAxisId="left" type="monotone" dataKey="cumulativeRoas" stroke="#00FF00" name="누적 ROAS" hide={!lineVisibility.cumulativeRoas} />
                      <Line yAxisId="left" type="monotone" dataKey="pocc" stroke="#FFA500" name="POCC" hide={!lineVisibility.pocc} />
                      <Line yAxisId="right" type="monotone" dataKey="dailySpend" stroke="#0000FF" name="지출금액(원)" hide={!lineVisibility.dailySpend} />
                      <Line yAxisId="right" type="monotone" dataKey="cumulativeSpend" stroke="#800080" name="누적 지출금액(원)" hide={!lineVisibility.cumulativeSpend} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </div>
              {/* 날짜별 데이터 표 */}
              <div style={{ overflowX: 'auto', marginTop: 20 }}>
                <table style={{ borderCollapse: 'collapse', minWidth: 600, width: '100%' }}>
                  <thead>
                    <tr>
                      <th style={{ border: '1px solid #ccc', padding: 4, background: '#f5f5f5', minWidth: 170, width: 170 }}>지표/날짜</th>
                      {processed.map((row) => (
                        <th key={row.date} style={{ border: '1px solid #ccc', padding: 4, background: '#f5f5f5' }}>
                          {row.date}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td style={{ border: '1px solid #ccc', padding: 4, fontWeight: 'bold', minWidth: 170, width: 170 }}>일별 ROAS</td>
                      {processed.map((row) => (
                        <td key={row.date + '-roas'} style={{ border: '1px solid #ccc', padding: 4 }}>
                          {row.dailyRoas?.toFixed(2)}
                        </td>
                      ))}
                    </tr>
                    <tr>
                      <td style={{ border: '1px solid #ccc', padding: 4, fontWeight: 'bold', minWidth: 170, width: 170 }}>누적 ROAS</td>
                      {processed.map((row) => (
                        <td key={row.date + '-curoas'} style={{ border: '1px solid #ccc', padding: 4 }}>
                          {row.cumulativeRoas?.toFixed(2)}
                        </td>
                      ))}
                    </tr>
                    <tr>
                      <td style={{ border: '1px solid #ccc', padding: 4, fontWeight: 'bold', minWidth: 170, width: 170 }}>POCC</td>
                      {processed.map((row) => (
                        <td key={row.date + '-pocc'} style={{ border: '1px solid #ccc', padding: 4 }}>
                          {row.pocc?.toFixed(2)}
                        </td>
                      ))}
                    </tr>
                    <tr>
                      <td style={{ border: '1px solid #ccc', padding: 4, fontWeight: 'bold', minWidth: 170, width: 170 }}>지출금액(원)</td>
                      {processed.map((row) => (
                        <td key={row.date + '-spend'} style={{ border: '1px solid #ccc', padding: 4 }}>
                          {row.dailySpend?.toLocaleString()}
                        </td>
                      ))}
                    </tr>
                    <tr>
                      <td style={{ border: '1px solid #ccc', padding: 4, fontWeight: 'bold', minWidth: 170, width: 170 }}>누적지출금액(원)</td>
                      {processed.map((row) => (
                        <td key={row.date + '-cumulativespend'} style={{ border: '1px solid #ccc', padding: 4 }}>
                          {row.cumulativeSpend?.toLocaleString()}
                        </td>
                      ))}
                    </tr>
                  </tbody>
                </table>
              </div>
              {optimal && (
                <div className="optimal-day">
                  <h3>최적 중단 시점 분석</h3>
                  <div className="optimal-info">
                    <p><strong>최적 중단 날짜:</strong> 5월 {optimal.date}일</p>
                    <p><strong>POCC 값:</strong> {optimal.pocc.toFixed(2)}</p>
                    <p><strong>누적 ROAS:</strong> {optimal.cumulativeRoas.toFixed(2)}</p>
                    <p><strong>누적 지출:</strong> {(optimal.cumulativeSpend/10000).toFixed(1)}만원</p>
                    <p><strong>일별 ROAS:</strong> {optimal.dailyRoas.toFixed(2)}</p>
                  </div>
                  <div className="analysis-summary">
                    <h4>분석 요약</h4>
                    <p>
                      5월 {optimal.date}일이 최적 중단 시점으로 분석되었습니다. 이 날짜는 목표 ROAS({optimal.targetReached ? '✓' : '✗'}), 
                      충분한 데이터({optimal.sufficientData ? '✓' : '✗'}), 
                      효율성 감소({optimal.efficiencyDecreasing ? '✓' : '✗'}) 조건을 모두 충족합니다.
                    </p>
                    <p>
                      상대적 성과 지수(RSI)는 {optimal.rsi.toFixed(2)}로 평균 대비 {((optimal.rsi - 1) * 100).toFixed(0)}% 높은 성과를 보였으며,
                      향후 예상되는 ROAS보다 {((optimal.efi - 1) * 100).toFixed(0)}% 높은 효율을 보여주고 있습니다.
                    </p>
                  </div>
                </div>
              )}
            </div>
          ))}
      </div>
    </div>
  );
}

export default App;