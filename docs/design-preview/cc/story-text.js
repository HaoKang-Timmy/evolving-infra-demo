// Illustrative terminal text shared with the original timing replay.
window.storyTranscript = function(i,tokens){
    if(i===24)return 'Updated filter changes to reset pagination. Added regression coverage for resetting the page and preserving filters during page navigation.\n\nThe change is ready for review.';
    if(tokens<90)return i<12?'I will inspect the current search state.':'I will check this case before continuing.';
    const target=Math.max(80,Math.min(14000,tokens*3.8));
    const fields=['status','tag','owner','label','project','priority','query','sort'];
    const intro=i<4?'I will trace the search request and its page state. The page should reset when the filters change.\n\n':i<12?'The filter update and page navigation need separate state transitions.\n\nsrc/search/query.ts\n\n':i<17?'I will add regression coverage for filter changes and page navigation.\n\ntests/search.test.ts\n\ndescribe("search pagination", () => {\n':i<22?'Reviewing the pagination change and its regression cases.\n\n':'The page reset and filter-preservation paths are covered. Reviewing the remaining cases before handing this back.\n\n';
    const blocks=[];let length=intro.length,k=0;
    while(length<target){
      const field=fields[k%fields.length],page=k+2;
      let block;
      if(i>=12&&i<17){
        block='  it("resets page '+page+' after changing '+field+'", () => {\n    const previous = { page: '+page+', filters: { '+field+': "before" } };\n    const next = updateFilters(previous, { '+field+': "after" });\n\n    expect(next.page).toBe(1);\n    expect(next.filters.'+field+').toBe("after");\n    expect(previous.page).toBe('+page+');\n  });\n\n';
        if(k%3===2)block+='  it("preserves '+field+' while moving to the next page", () => {\n    const state = { page: 1, filters: { '+field+': "selected" } };\n    const next = nextPage(state);\n    expect(next.page).toBe(2);\n    expect(next.filters).toEqual(state.filters);\n  });\n\n';
      }else if(i<12){
        block='  // '+(k+1)+'. Update '+field+' independently of page navigation.\n  function set'+field[0].toUpperCase()+field.slice(1)+'(state, value) {\n    return {\n      ...state,\n      filters: { ...state.filters, '+field+': value },\n      page: 1,\n    };\n  }\n\n';
      }else{
        block='  '+(k+1)+'. Changing '+field+' resets the page index.\n     Moving between pages preserves the selected '+field+'.\n     The original state stays unchanged.\n\n';
      }
      blocks.push(block);length+=block.length;k++;
    }
    // Whole sentences and complete snippets keep the illustration readable.
    return intro+blocks.join('')+(i>=12&&i<17?'});\n':'');
  };
